import { useState, useCallback } from 'react';
import {
  StarkZap,
  StarkSigner,
  OnboardStrategy,
  sepoliaTokens,
  Amount,
  fromAddress,
} from 'starkzap';
import type { WalletInterface, Address } from 'starkzap';
import {
  Heart, X, MessageCircle, User, ShieldCheck, Flame, Send,
  TrendingUp, LogOut, CheckCircle, Loader, ExternalLink, Star, MapPin,
  Briefcase, ArrowRight, FlaskConical, Key, RefreshCw, Copy, Award,
  Lock, Clock, Sparkles, CalendarHeart, Map, CalendarCheck, Check
} from 'lucide-react';
import './App.css';

// ─── Starkzap SDK singleton ───────────────────────────────────────────────────
let _sdk: StarkZap | null = null;
function getSDK(): StarkZap {
  if (!_sdk) _sdk = new StarkZap({ network: 'sepolia', rpcUrl: 'https://api.cartridge.gg/x/starknet/sepolia' });
  return _sdk;
}

const NETHERMIND_VALIDATOR = '0x05c85dd30df86ed1f2cfe1806417efb2cae421bffdee8110a74a3d3eb95b28d3';
let _poolAddr: Address | null = null;

async function getPoolAddress(): Promise<Address> {
  if (_poolAddr) return _poolAddr;
  const pools = await getSDK().getStakerPools(fromAddress(NETHERMIND_VALIDATOR));
  const strk   = pools.find(p => p.token.symbol === 'STRK') ?? pools[0];
  if (!strk) throw new Error('No STRK pool found for Nethermind validator');
  _poolAddr = strk.poolContract;
  return _poolAddr;
}

function isRetryable(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return ['contractnotfound','storage operation failed','provider error','session','revoked',
    '404','network','fetch','failed to initialize','please try again'].some(s => m.includes(s));
}

function isGaslessFallback(msg: string): boolean {
  const m = msg.toLowerCase();
  return ['gasless','sponsored','paymaster','not in policies','snip-9','not compatible',
    "doesn't support","does not support","strk","eth","failed to fetch price",
    "insufficient liquidity"].some(s => m.includes(s));
}

// ─── Demo wallet ───────────────────────────────────────────────────────────────
const DEMO_ADDR = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
const demoBals: Record<string, number> = { STRK: 250.5, ETH: 0.08 };
const demoStaked = { staked: '100.0 STRK', rewards: '2.347 STRK', commissionPercent: 10 };

function makeDemoWallet(): WalletInterface {
  const fakeChain: any = { isSepolia: () => true, isMainnet: () => false };
  const randHash = () => '0x' + Array.from({length:64}, () => Math.floor(Math.random()*16).toString(16)).join('');
  const fakeTx   = (hash: string) => ({ hash, explorerUrl: `https://sepolia.voyager.online/tx/${hash}`, wait: async () => {}, watch: () => () => {}, receipt: async () => ({} as any) } as any);
  return {
    address: fromAddress(DEMO_ADDR) as any,
    getChainId: () => fakeChain,
    getAccount: () => null as any, getProvider: () => null as any,
    getFeeMode: () => 'user_pays' as any,
    isDeployed: async () => true, ensureReady: async () => {},
    balanceOf: async (token: any) => { const b = demoBals[token.symbol] ?? 0; return Amount.fromRaw(BigInt(Math.round(b * 10**token.decimals)), token); },
    transfer: async (token: any, txs: any[]) => { await new Promise(r => setTimeout(r, 1800)); const tot = txs.reduce((s: number, t: any) => s + Number(t.amount.toUnit()), 0); demoBals[token.symbol] = Math.max(0, (demoBals[token.symbol]??0) - tot); return fakeTx(randHash()); },
    stake: async (_p: any, amount: any) => { await new Promise(r => setTimeout(r, 2000)); const n = Number(amount.toUnit()); demoBals['STRK'] = Math.max(0, (demoBals['STRK']??0) - n); demoStaked.staked = `${(parseFloat(demoStaked.staked)+n).toFixed(1)} STRK`; return fakeTx(randHash()); },
    claimPoolRewards: async () => { await new Promise(r => setTimeout(r, 1500)); demoBals['STRK'] = (demoBals['STRK']??0) + 2.347; demoStaked.rewards = '0.000 STRK'; return fakeTx(randHash()); },
    exitPoolIntent: async () => { await new Promise(r => setTimeout(r, 1500)); return fakeTx(randHash()); },
    getPoolPosition: async () => ({ staked: Amount.fromRaw(BigInt(100*10**18), sepoliaTokens.STRK), rewards: Amount.fromRaw(BigInt(Math.round(2.347*10**18)), sepoliaTokens.STRK), commissionPercent: 10, rewardAddress: fromAddress(DEMO_ADDR), total: Amount.fromRaw(BigInt(102*10**18), sepoliaTokens.STRK), unpooling: Amount.fromRaw(0n, sepoliaTokens.STRK) }) as any,
  } as unknown as WalletInterface;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab    = 'discover' | 'matches' | 'dates' | 'wallet' | 'staking';
type Screen = 'login' | 'app';
type DateStatus = 'scheduled' | 'checked_in_me' | 'verified';

interface Profile { 
  id: number; name: string; age: number; bio: string; promptQ: string; promptA: string; 
  image: string; job: string; location: string; verified?: boolean;
  score: number;
  verifiedDates: number;
  ghostRate: number;
}

interface DateObj {
  id: string;
  match: Profile;
  location: string;
  time: string;
  status: DateStatus;
}

const PROFILES: Profile[] = [
  { id:1, name:'Maya', age:25, bio:'Starknet Maxi. Let\'s get coffee and discuss validity rollups.', promptQ:'Ideal first date…', promptA:'A local hackathon or a quiet cafe.', image:'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600', job:'Cairo Dev', location:'San Francisco', verified:true, score: 184, verifiedDates: 14, ghostRate: 0 },
  { id:2, name:'Rahul', age:28, bio:'DeFi researcher. Can I audit your smart contracts?', promptQ:'I go crazy for…', promptA:'Clean code and zero downtime.', image:'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=600', job:'Protocol Engineer', location:'Remote', score: 92, verifiedDates: 6, ghostRate: 0 },
  { id:3, name:'Alice', age:24, bio:'Just exploring the ecosystem. Not sure what a sequencer is yet.', promptQ:'Looking for…', promptA:'Someone to show me around Web3.', image:'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&q=80&w=600', job:'Designer', location:'New York', score: 0, verifiedDates: 0, ghostRate: 60 },
  { id:4, name:'Jordan', age:26, bio:'Full time node operator. Coffee addict.', promptQ:'I spend most of my time…', promptA:'Syncing nodes and drinking espresso.', image:'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=600', job:'Validator', location:'Berlin', verified:true, score: 150, verifiedDates: 10, ghostRate: 5 },
];

export default function App() {
  const [screen,     setScreen]     = useState<Screen>('login');
  const [wallet,     setWallet]     = useState<WalletInterface | null>(null);
  const [isDemo,     setIsDemo]     = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState('');
  const [showPkInput, setShowPkInput] = useState(false);
  const [pkInput,     setPkInput]     = useState('');

  const [activeTab,    setActiveTab]    = useState<Tab>('discover');
  const [profileIndex, setProfileIndex] = useState(0);
  const [matches,      setMatches]      = useState<Profile[]>([]);
  const [dates,        setDates]        = useState<DateObj[]>([]);
  const [swipeDir,     setSwipeDir]     = useState<'left'|'right'|null>(null);
  const [swipeFeedback, setSwipeFeedback] = useState<'like'|'pass'|null>(null);

  // Reputation My Identity
  const [myScore, setMyScore] = useState(45);
  const [myVerifiedDates, setMyVerifiedDates] = useState(2);

  const [dateModalOpen, setDateModalOpen] = useState<Profile | null>(null);

  // Wallet
  const [strkBal,    setStrkBal]    = useState('–');
  const [ethBal,     setEthBal]     = useState('–');
  const [walletAddr, setWalletAddr] = useState('');
  const [sendTo,     setSendTo]     = useState('');
  const [sendAmt,    setSendAmt]    = useState('');
  const [txStatus,   setTxStatus]   = useState<'idle'|'sending'|'success'|'error'>('idle');
  const [txUrl,      setTxUrl]      = useState('');
  const [copied,     setCopied]     = useState(false);

  // Staking
  const [stakeAmt,       setStakeAmt]       = useState('');
  const [stakeStatus,    setStakeStatus]    = useState<'idle'|'loading'|'success'|'error'>('idle');
  const [stakeMsg,       setStakeMsg]       = useState('');
  const [poolPosition,   setPoolPosition]   = useState<{staked:string; rewards:string; commission:number}|null>(null);

  const refreshBalances = useCallback(async (w: WalletInterface) => {
    const tok = sepoliaTokens;
    const [s, e] = await Promise.allSettled([w.balanceOf(tok.STRK), w.balanceOf(tok.ETH)]);
    if (s.status === 'fulfilled') setStrkBal(s.value.toFormatted(true));
    if (e.status === 'fulfilled') setEthBal(e.value.toFormatted(true));
  }, []);

  const refreshPosition = useCallback(async (w: WalletInterface) => {
    try {
      const pool = await getPoolAddress();
      const pos  = await w.getPoolPosition(pool);
      if (pos) setPoolPosition({ staked: pos.staked.toFormatted(true), rewards: pos.rewards.toFormatted(true), commission: pos.commissionPercent });
      else setPoolPosition(null);
    } catch { setPoolPosition(null); }
  }, []);

  const bootWallet = async (w: WalletInterface, demo: boolean) => {
    setWallet(w); setIsDemo(demo); setWalletAddr(w.address.toString());
    await Promise.allSettled([refreshBalances(w), refreshPosition(w)]);
    setScreen('app');
  };

  const connectCartridge = async () => {
    setConnecting(true); setConnectErr('');
    const sdk = getSDK();
    const doOnboard = async () => {
      const pool = await getPoolAddress();
      return sdk.onboard({
        strategy: OnboardStrategy.Cartridge,
        cartridge: {
          policies: [
            { target: sepoliaTokens.STRK.address, method: 'transfer' },
            { target: sepoliaTokens.STRK.address, method: 'approve' },
            { target: pool, method: 'enter_delegation_pool' },
            { target: pool, method: 'add_to_delegation_pool' },
            { target: pool, method: 'exit_delegation_pool_intent' },
            { target: pool, method: 'exit_delegation_pool_action' },
            { target: pool, method: 'claim_rewards' },
          ],
        },
        deploy: 'if_needed',
      });
    };
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { wallet: w } = await doOnboard();
        await bootWallet(w, false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < 2 && isRetryable(err)) { await new Promise(r => setTimeout(r, 800)); continue; }
        break;
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    setConnectErr(msg.toLowerCase().includes('popup') || msg.toLowerCase().includes('block')
      ? 'Popup blocked. Allow popups for localhost.' : 'Connection failed. Try again.');
    setConnecting(false);
  };

  const connectWithPK = async () => {
    if (!pkInput.trim()) return;
    setConnecting(true); setConnectErr('');
    try {
      const { wallet: w } = await getSDK().onboard({ strategy: OnboardStrategy.Signer, account: { signer: new StarkSigner(pkInput.trim()) }, deploy: 'if_needed' });
      await bootWallet(w, false);
    } catch (err: any) { setConnectErr(err?.message ?? 'Invalid key.'); setConnecting(false); }
  };

  const connectDemo = async () => { setConnecting(true); await new Promise(r => setTimeout(r, 800)); await bootWallet(makeDemoWallet(), true); setConnecting(false); };

  const disconnect = async () => { if (wallet && !isDemo) await wallet.disconnect(); setWallet(null); setIsDemo(false); setScreen('login'); };

  const swipe = (dir: 'left'|'right') => {
    setSwipeFeedback(dir === 'right' ? 'like' : 'pass');
    setSwipeDir(dir);
    setTimeout(() => {
      if (dir === 'right') setMatches(p => [...p, PROFILES[profileIndex]]);
      setProfileIndex(i => i + 1);
      setSwipeDir(null); setSwipeFeedback(null);
    }, 380);
  };

  const scheduleDate = () => {
    if (!dateModalOpen) return;
    const newDate: DateObj = {
      id: Math.random().toString(36).substr(2, 9),
      match: dateModalOpen,
      location: 'Local Cafe Spot',
      time: 'Tomorrow, 6:00 PM',
      status: 'scheduled'
    };
    setDates(prev => [...prev, newDate]);
    setDateModalOpen(null);
    setActiveTab('dates');
  };

  const checkInDate = async (id: string) => {
    // Simulate user check in
    setDates(prev => prev.map(d => d.id === id ? { ...d, status: 'checked_in_me' } : d));
    
    // Simulate other user checking in 1.5 seconds later
    setTimeout(() => {
      setDates(prev => prev.map(d => d.id === id ? { ...d, status: 'verified' } : d));
      setMyScore(s => s + 25);
      setMyVerifiedDates(c => c + 1);
      // Simulate rewards
      if (isDemo && wallet) {
        demoBals['STRK'] = (demoBals['STRK']??0) + 5;
        refreshBalances(wallet);
      }
    }, 1500);
  };

  const sendTokens = async () => {
    const amt = parseFloat(sendAmt);
    if (!wallet || !sendTo.trim() || !sendAmt || isNaN(amt) || amt <= 0) return;
    setTxStatus('sending'); setTxUrl('');
    try {
      const STRK = sepoliaTokens.STRK;
      let url: string;
      try {
        const tx = await wallet.transfer(STRK, [{ to: fromAddress(sendTo.trim()), amount: Amount.parse(sendAmt, STRK) }], { feeMode: 'sponsored' });
        await tx.wait(); url = tx.explorerUrl;
      } catch (err: any) {
        if (isGaslessFallback(err?.message ?? '')) {
          const tx = await wallet.transfer(STRK, [{ to: fromAddress(sendTo.trim()), amount: Amount.parse(sendAmt, STRK) }], { feeMode: 'user_pays' });
          await tx.wait(); url = tx.explorerUrl;
        } else throw err;
      }
      setTxUrl(url!); setTxStatus('success');
      await refreshBalances(wallet);
    } catch (e: any) { setTxStatus('error'); }
  };

  const stakeTokens = async () => {
    const n = parseFloat(stakeAmt);
    if (!wallet || !stakeAmt || isNaN(n) || n <= 0) {
      setStakeStatus('error'); setStakeMsg('Enter > 0.'); return;
    }
    setStakeStatus('loading'); setStakeMsg('');
    try {
      const pool = isDemo ? fromAddress('0x05c85dd30df86ed1f2cfe1806417efb2cae421bffdee8110a74a3d3eb95b28d3') : await getPoolAddress();
      const tx = await wallet.stake(pool, Amount.parse(stakeAmt, sepoliaTokens.STRK), { feeMode: 'user_pays' });
      await tx.wait();
      setStakeStatus('success'); setStakeMsg(`✓ Staked! Tx: ${tx.hash.slice(0,14)}…`); setStakeAmt('');
      await Promise.allSettled([refreshBalances(wallet), refreshPosition(wallet)]);
    } catch (e: any) { setStakeStatus('error'); setStakeMsg(e?.message ?? 'Staking failed.'); }
  };

  const copyAddress = () => { navigator.clipboard.writeText(walletAddr); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const shortAddr = walletAddr ? `${walletAddr.slice(0,8)}…${walletAddr.slice(-4)}` : '–';
  const currentProfile = PROFILES[profileIndex] ?? null;

  if (screen === 'login') return (
    <div className="app-root">
      <div className="login-screen">
        <div className="login-bg-blur"/>
        <div className="login-content">
          <div className="login-logo-wrap">
            <div className="logo-icon"><Flame size={20}/></div>
            <h1 className="login-logo">StarkMatch</h1>
          </div>
          <p className="login-tagline">Real trust, on-chain.</p>
          <p className="login-sub">The Web3 dating app where real-world reliability becomes an on-chain reputation.</p>

          <div className="login-features">
            <div className="feat-chip"><ShieldCheck size={12}/> Verified real dates</div>
            <div className="feat-chip"><Award size={12}/> Reputation scoring</div>
            <div className="feat-chip"><TrendingUp size={12}/> Date-to-Earn Rewards</div>
          </div>

          <button id="connect-cartridge-btn" className="connect-btn" onClick={connectCartridge} disabled={connecting}>
            {connecting
              ? <><Loader size={15} className="spin"/> Connecting…</>
              : <><img src="https://cartridge.gg/favicon.ico" width={16} height={16} style={{borderRadius:3}} alt=""/> Continue with Cartridge</>
            }
          </button>
          {connectErr && <div className="error-banner">{connectErr}</div>}
          <div className="divider"><span>or</span></div>
          {!showPkInput ? (
            <button id="connect-pk-btn" className="connect-btn-ghost" onClick={() => setShowPkInput(true)} disabled={connecting}>
              <Key size={14}/> Private Key — Sepolia Testnet
            </button>
          ) : (
            <div className="pk-group">
              <input className="text-input" type="password" placeholder="0x… private key" value={pkInput} onChange={e => setPkInput(e.target.value)} onKeyDown={e => e.key==='Enter' && connectWithPK()}/>
              <button className="pk-go-btn" onClick={connectWithPK} disabled={connecting || !pkInput.trim()}>
                {connecting ? <Loader size={14} className="spin"/> : <ArrowRight size={15}/>}
              </button>
            </div>
          )}
          <div className="divider"><span>or</span></div>
          <button id="connect-demo-btn" className="connect-btn-ghost demo-ghost" onClick={connectDemo} disabled={connecting}>
            <FlaskConical size={14}/> Explore Demo Mode
          </button>
          <p className="login-legal">By continuing you agree to our Terms of Service.</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="app-header">
          <div className="header-left">
            <div className="addr-pill">{shortAddr}</div>
            {isDemo && <span className="demo-pill">DEMO</span>}
          </div>
          <div className="header-score">
            <Award size={13} color="var(--gold-light)"/> <span style={{color:'var(--gold-light)', fontWeight: 600, fontSize: '0.8rem'}}>{myScore} SP</span>
          </div>
          <button className="icon-btn" onClick={disconnect} title="Disconnect"><LogOut size={18}/></button>
        </header>

        <main className="app-main">

          {activeTab === 'discover' && (
            <div className="discover-tab">
              {currentProfile ? (
                <div className={`profile-card${swipeDir==='left'?' swipe-left':swipeDir==='right'?' swipe-right':''}`}>
                  {swipeFeedback === 'like' && <div className="swipe-label like-label"><Heart size={28} fill="currentColor"/> LIKE</div>}
                  {swipeFeedback === 'pass' && <div className="swipe-label pass-label"><X size={28}/> PASS</div>}
                  <div className="profile-image-wrap">
                    <img src={currentProfile.image} alt={currentProfile.name} className="profile-image"/>
                    <div className="profile-overlay">
                      <div className="profile-badges">
                        {currentProfile.verified && <span className="badge verified-badge"><ShieldCheck size={11}/> Verified Identity</span>}
                        {currentProfile.verifiedDates > 5 && <span className="badge" style={{color:'#FCD34D', borderColor:'rgba(252,211,77,0.3)', background:'rgba(180,83,9,0.2)'}}><Star size={11} fill="currentColor"/> Reliable Dater</span>}
                        {currentProfile.ghostRate > 30 && <span className="badge danger-badge"><Flame size={11}/> High Ghost Rate</span>}
                      </div>
                      <div className="profile-basic">
                        <h2>{currentProfile.name}, {currentProfile.age}</h2>
                        <p><Briefcase size={12}/> {currentProfile.job}</p>
                        <p><MapPin size={12}/> {currentProfile.location}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="reputation-bar">
                    <div className="rep-stat"><span className="rep-val">{currentProfile.score}</span><span className="rep-label">Social Proof</span></div>
                    <div className="rep-stat"><span className="rep-val">{currentProfile.verifiedDates}</span><span className="rep-label">Verified Dates</span></div>
                    <div className="rep-stat"><span className="rep-val">{currentProfile.ghostRate}%</span><span className="rep-label">Ghost Rate</span></div>
                  </div>

                  <div className="profile-body">
                    <div className="prompt-block">
                      <span className="prompt-q">{currentProfile.promptQ}</span>
                      <p className="prompt-a">"{currentProfile.promptA}"</p>
                    </div>
                    <p className="profile-bio">{currentProfile.bio}</p>
                  </div>
                  <div className="action-row">
                    <button className="act-btn act-pass" onClick={() => swipe('left')}><X size={26}/></button>
                    <button className="act-btn act-msg" onClick={() => swipe('right')}><Sparkles size={20}/></button>
                    <button className="act-btn act-like" onClick={() => swipe('right')}><Heart size={26}/></button>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <Flame size={52} className="empty-icon"/><h2>All caught up!</h2>
                  <p>Increase your Social Proof Score to unlock more verified matches.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'matches' && (
            <div className="matches-tab">
              <h3 className="section-title">Your Matches <span className="count-pill">{matches.length}</span></h3>
              {matches.length === 0 ? (
                <div className="empty-state"><Heart size={48} className="empty-icon"/><h2>No matches yet</h2><p>Swipe to find your Web3 soulmate!</p></div>
              ) : (
                <div className="matches-list">{matches.map(m => (
                  <div key={m.id} className="match-card">
                    <img src={m.image} alt={m.name} className="match-avatar"/>
                    <div className="match-info">
                      <span className="match-name">{m.name} <span style={{fontSize:'0.7rem', color:'var(--gold-light)'}}>★ {m.score}</span></span>
                      <span className="match-job">{m.job}</span>
                    </div>
                    <button className="match-msg-btn"><MessageCircle size={16}/></button>
                    <button className="match-msg-btn" style={{color:'var(--rose)'}} onClick={() => setDateModalOpen(m)}><CalendarHeart size={16}/></button>
                  </div>
                ))}</div>
              )}

              {dateModalOpen && (
                <div className="modal-overlay" onClick={() => setDateModalOpen(null)}>
                  <div className="modal-content" onClick={e => e.stopPropagation()}>
                    <h3 style={{marginBottom:'10px'}}>Schedule a Date</h3>
                    <p style={{fontSize:'0.85rem', color:'var(--t2)', marginBottom:'20px'}}>Scheduling an on-chain date with {dateModalOpen.name}. Both users must check-in to verify the date and earn STRK rewards.</p>
                    <div style={{display:'flex', gap:'10px', marginBottom:'20px'}}>
                       <input className="text-input" placeholder="Location" defaultValue="Local Cafe Spot" style={{flex:1}}/>
                       <input className="text-input" type="time" defaultValue="18:00" style={{width:'100px'}}/>
                    </div>
                    <button className="action-btn-primary" style={{width:'100%'}} onClick={scheduleDate}>Send Invitation</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'dates' && (
            <div className="dates-tab">
              <h3 className="section-title">Scheduled Dates <span className="count-pill">{dates.length}</span></h3>
              
              <div className="reputation-summary panel">
                <h4 className="panel-title" style={{marginBottom:'8px'}}><Award size={15}/> Your Reputation</h4>
                <div className="rep-stats-grid">
                  <div className="rep-stat-box">
                    <span className="rs-val gold">{myScore}</span><span className="rs-label">Proof Score</span>
                  </div>
                  <div className="rep-stat-box">
                    <span className="rs-val">{myVerifiedDates}</span><span className="rs-label">Verified Dates</span>
                  </div>
                  <div className="rep-stat-box">
                    <span className="rs-val green">0%</span><span className="rs-label">Ghost Rate</span>
                  </div>
                </div>
              </div>

              {dates.length === 0 ? (
                <div className="empty-state"><CalendarHeart size={48} className="empty-icon"/><h2>No upcoming dates</h2><p>Schedule a date from your Matches tab.</p></div>
              ) : (
                <div className="dates-list">
                  {dates.map(date => (
                    <div key={date.id} className="date-card">
                      <div className="date-header">
                        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                           <img src={date.match.image} style={{width: 32, height: 32, borderRadius:'50%', objectFit:'cover'}} alt=""/>
                           <span className="date-match-name">Date with {date.match.name}</span>
                        </div>
                        {date.status === 'scheduled' && <span className="date-badge waiting">Scheduled</span>}
                        {date.status === 'checked_in_me' && <span className="date-badge waiting">Waiting for {date.match.name}</span>}
                        {date.status === 'verified' && <span className="date-badge verified"><Check size={10}/> Verified</span>}
                      </div>

                      <div className="date-details">
                        <div className="dp-row"><Map size={13}/> <span>{date.location}</span></div>
                        <div className="dp-row"><Clock size={13}/> <span>{date.time}</span></div>
                      </div>

                      {date.status === 'scheduled' && (
                        <button className="action-btn-primary" style={{width:'100%', padding:'10px', marginTop:'12px'}} onClick={() => checkInDate(date.id)}>
                          <MapPin size={14}/> Check In Now
                        </button>
                      )}
                      {date.status === 'checked_in_me' && (
                        <div className="check-in-wait">
                          <Loader size={14} className="spin"/> <span>Waiting for verification contract...</span>
                        </div>
                      )}
                      {date.status === 'verified' && (
                        <div className="verify-success">
                          <div className="vs-header"><Sparkles size={16}/> Date Verified On-Chain!</div>
                          <p>+25 Social Proof Score</p>
                          <p>+5 STRK Reward Deposited</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'wallet' && (
            <div className="wallet-tab">
              <div className="balance-cards">
                <div className="bal-card bal-strk"><span className="bal-token">STRK</span><span className="bal-amount">{strkBal}</span></div>
                <div className="bal-card bal-eth"><span className="bal-token">ETH</span><span className="bal-amount">{ethBal}</span></div>
              </div>
              <div className="addr-card" onClick={copyAddress}>
                <span className="addr-label">Wallet Address</span>
                <div className="addr-row"><span className="addr-val">{walletAddr.slice(0,12)}…{walletAddr.slice(-8)}</span>{copied ? <CheckCircle size={14} color="var(--green)"/> : <Copy size={14} color="var(--t3)"/>}</div>
              </div>
              <div className="panel">
                <h4 className="panel-title"><Send size={14}/> Send STRK</h4>
                <input className="text-input" placeholder="Recipient address (0x…)" value={sendTo} onChange={e => setSendTo(e.target.value)}/>
                <input className="text-input" placeholder="Amount" type="number" min="0" value={sendAmt} onChange={e => setSendAmt(e.target.value)}/>
                <button className="action-btn-primary" onClick={sendTokens} disabled={txStatus==='sending'}>
                  {txStatus==='sending' ? <Loader size={14} className="spin"/> : "Send"}
                </button>
                {txStatus==='success' && <div className="tx-success"><CheckCircle size={13}/> Sent {txUrl && <a href={txUrl} target="_blank" rel="noopener noreferrer" className="tx-link">Explorer</a>}</div>}
              </div>
            </div>
          )}

          {activeTab === 'staking' && (
            <div className="staking-tab">
              <div className="position-card">
                <div className="pos-header">
                  <span className="pos-title"><Award size={15}/> Staking Yield</span>
                  <button className="refresh-btn" onClick={() => wallet && refreshPosition(wallet)}><RefreshCw size={13}/></button>
                </div>
                {poolPosition ? (
                  <div className="pos-stats">
                    <div className="pos-stat"><span className="pos-stat-label">Staked</span><span className="pos-stat-val green">{poolPosition.staked}</span></div>
                    <div className="pos-stat"><span className="pos-stat-label">Rewards</span><span className="pos-stat-val gold">{poolPosition.rewards}</span></div>
                    <div className="pos-stat"><span className="pos-stat-label">Comm</span><span className="pos-stat-val">{poolPosition.commission}%</span></div>
                  </div>
                ) : <p className="pos-empty">No active stake.</p>}
              </div>

              <div className="panel">
                <h4 className="panel-title"><Lock size={14}/> Stake Idle Funds</h4>
                <div className="helper-row">
                  <p className="helper">Balance: <strong>{strkBal}</strong></p>
                  <a href="https://starknet-faucet.vercel.app/" target="_blank" rel="noopener noreferrer" className="faucet-link">Get testnet STRK <ExternalLink size={10}/></a>
                </div>
                <input className="text-input" placeholder="Amount (STRK)" type="number" value={stakeAmt} onChange={e => setStakeAmt(e.target.value)}/>
                <button className="action-btn-primary btn-green" onClick={stakeTokens} disabled={stakeStatus==='loading'}>{stakeStatus==='loading' ? <Loader size={14} className="spin"/> : "Stake STRK"}</button>
                {stakeStatus==='success' && <div className="tx-success"><CheckCircle size={13}/> {stakeMsg}</div>}
              </div>
            </div>
          )}

        </main>

        <nav className="bottom-nav">
          {([['discover',Flame,'Discover'],['matches',Heart,'Matches'],['dates',CalendarCheck,'Dates'],['wallet',User,'Wallet'],['staking',TrendingUp,'Stake']] as const).map(([tab, Icon, label]) => (
            <button key={tab} className={`nav-btn${activeTab===tab?' active':''}`} onClick={() => setActiveTab(tab as Tab)}>
              <Icon size={20}/>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
