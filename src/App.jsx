import { useState, useEffect, useRef, useCallback } from 'react'

// ─── CONSTANTS ────────────────────────────────────────────────
const INITIAL_CASH = 100000
const TARGET       = 1000000
const STORAGE_KEY  = 'ai_investor_v3'

const AI_PROFILES = [
  {
    id: 'claude',
    name: 'Claude',
    label: '稳健派',
    color: '#f59e0b',
    avatar: '🔵',
    model: 'claude',
    apiKeyName: 'claudeKey',
    personality: `你是Claude，一位极度稳健的价值投资者。
你的风格：
- 只买ROE>15%、PE<30的优质公司
- 单只股票仓位不超过25%
- 亏损超过8%立刻止损
- 持有现金等待真正的机会
- 决策前必须分析基本面
你的目标是把10万元稳健增长到100万元。`
  },
  {
    id: 'gpt',
    name: 'GPT-4',
    label: '激进派',
    color: '#10b981',
    avatar: '🟢',
    model: 'gpt',
    apiKeyName: 'gptKey',
    personality: `你是GPT-4，一位激进的成长股猎手。
你的风格：
- 追逐高增长赛道：AI、新能源、半导体
- 敢于重仓，单只股票可以押注40%
- 追涨动量，不怕高估值
- 快进快出，抓住短期机会
- 相信未来趋势大于当前估值
你的目标是尽快把10万元变成100万元。`
  },
  {
    id: 'gemini',
    name: 'Gemini',
    label: '量化派',
    color: '#3b82f6',
    avatar: '🔴',
    model: 'gemini',
    apiKeyName: 'geminiKey',
    personality: `你是Gemini，一位纯数据驱动的量化交易者。
你的风格：
- 完全依赖数字和指标，忽视市场情绪
- 看重PE、PB、ROE、股息率的综合评分
- 严格的仓位管理，每只股票权重相等
- 定期再平衡，不受涨跌影响
- 用统计规律而不是故事选股
你的目标是用量化策略把10万元变成100万元。`
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    label: '本土派',
    color: '#8b5cf6',
    avatar: '🟡',
    model: 'deepseek',
    apiKeyName: 'deepseekKey',
    personality: `你是DeepSeek，一位深耕A股的本土投资专家。
你的风格：
- 极度熟悉A股政策和监管环境
- 重视政策导向：国家支持的赛道优先
- 关注北向资金和机构动向
- 懂得利用A股独特的涨跌停机制
- 结合宏观政策和微观基本面
你的目标是用A股本土优势把10万元变成100万元。`
  }
]

// Stock sectors for dynamic pool
const SECTORS = {
  '白酒': ['600519','000858','000596','002304','603589'],
  '新能源': ['300750','002594','601012','688599','300014'],
  '银行': ['000001','601318','600036','601166','000002'],
  '科技': ['688111','002230','300059','601138','688981'],
  '医药': ['300015','600276','002475','300122','000538'],
  '消费': ['600887','603288','000895','002557','603605'],
  '军工': ['600760','002409','000768','600893','300776'],
  '光伏': ['601012','688472','300274','002459','603806'],
}

// ─── STORAGE ──────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

function initAI(profile) {
  return {
    id: profile.id,
    cash: INITIAL_CASH,
    holdings: {},           // { code: { qty, avgCost, name } }
    trades: [],             // trade history
    priceHistory: [],       // { date, totalValue }
    summary: null,          // latest strategy summary
    summaryHistory: [],     // all past summaries
    thinking: false,
    lastTradeDay: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
  }
}

function initState() {
  return {
    aiStates: Object.fromEntries(AI_PROFILES.map(p => [p.id, initAI(p)])),
    apiKeys: { claudeKey:'', gptKey:'', geminiKey:'', deepseekKey:'' },
    tradeDay: 0,
    startDate: new Date().toISOString(),
    stockPrices: {},        // { code: price }
    stockMeta: {},          // { code: { name, sector, pe, roe, change } }
    newsLog: [],
    configDone: false,
  }
}

// ─── STOCK DATA ───────────────────────────────────────────────
const STOCK_NAMES = {
  '600519':'贵州茅台','000858':'五粮液','000596':'古井贡酒','002304':'洋河股份','603589':'口子窖',
  '300750':'宁德时代','002594':'比亚迪','601012':'隆基绿能','688599':'天合光能','300014':'亿纬锂能',
  '000001':'平安银行','601318':'中国平安','600036':'招商银行','601166':'兴业银行','000002':'万科A',
  '688111':'金山办公','002230':'科大讯飞','300059':'东方财富','601138':'工业富联','688981':'中芯国际',
  '300015':'爱尔眼科','600276':'恒瑞医药','002475':'立讯精密','300122':'智飞生物','000538':'云南白药',
  '600887':'伊利股份','603288':'海天味业','000895':'双汇发展','002557':'洽洽食品','603605':'珀莱雅',
  '600760':'中航沈飞','002409':'雅克科技','000768':'中航西飞','600893':'航发动力','300776':'帝尔激光',
  '688472':'阿特斯','300274':'阳光电源','002459':'晶澳科技','603806':'福斯特',
}

async function fetchStockPrice(code) {
  try {
    const suffix = code.startsWith('6') ? '.SS' : '.SZ'
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?interval=1d&range=5d`
    const res  = await fetch(url)
    const data = await res.json()
    const quotes = data?.chart?.result?.[0]
    if (!quotes) return null
    const closes = quotes.indicators?.quote?.[0]?.close || []
    const latest = closes.filter(Boolean).pop()
    const prev   = closes.filter(Boolean).slice(-2)[0] || latest
    return {
      price:  parseFloat(latest?.toFixed(2) || 0),
      change: prev ? parseFloat(((latest - prev) / prev * 100).toFixed(2)) : 0,
      prev:   parseFloat(prev?.toFixed(2) || 0),
    }
  } catch {
    return null
  }
}

async function fetchMultipleStocks(codes) {
  const results = {}
  await Promise.allSettled(codes.map(async code => {
    const data = await fetchStockPrice(code)
    if (data) results[code] = data
  }))
  return results
}

// Fallback prices when API fails
const FALLBACK_PRICES = {
  '600519':1680,'000858':142,'000596':158,'002304':78,'603589':35,
  '300750':198,'002594':235,'601012':22,'688599':18,'300014':45,
  '000001':10.85,'601318':42,'600036':38,'601166':18,'000002':8,
  '688111':245,'002230':28,'300059':22,'601138':6.5,'688981':55,
  '300015':15,'600276':38,'002475':18,'300122':42,'000538':68,
  '600887':28,'603288':42,'000895':22,'002557':18,'603605':85,
  '600760':55,'002409':32,'000768':48,'600893':35,'300776':65,
  '688472':12,'300274':55,'002459':22,'603806':35,
}

// ─── AI API CALLS ─────────────────────────────────────────────
async function callClaude(apiKey, systemPrompt, userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

async function callGPT(apiKey, systemPrompt, userMessage) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    })
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callGemini(apiKey, systemPrompt, userMessage) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }]
    })
  })
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function callDeepSeek(apiKey, systemPrompt, userMessage) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    })
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callAI(profile, apiKey, systemPrompt, userMessage) {
  switch (profile.model) {
    case 'claude':   return callClaude(apiKey, systemPrompt, userMessage)
    case 'gpt':      return callGPT(apiKey, systemPrompt, userMessage)
    case 'gemini':   return callGemini(apiKey, systemPrompt, userMessage)
    case 'deepseek': return callDeepSeek(apiKey, systemPrompt, userMessage)
    default:         return ''
  }
}

function parseAIResponse(text) {
  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/)
    const jsonStr = match ? match[1] : text
    return JSON.parse(jsonStr.trim())
  } catch {
    return null
  }
}

// ─── HELPERS ──────────────────────────────────────────────────
function totalValue(aiState, prices) {
  let val = aiState.cash
  for (const [code, h] of Object.entries(aiState.holdings)) {
    const p = prices[code] || h.avgCost
    val += h.qty * p
  }
  return val
}

function fmtMoney(n) {
  if (n >= 10000) return `${(n/10000).toFixed(2)}万`
  return n.toFixed(0)
}

function fmtPct(n) {
  const s = n >= 0 ? '+' : ''
  return `${s}${n.toFixed(2)}%`
}

function profitPct(aiState, prices) {
  const val = totalValue(aiState, prices)
  return (val - INITIAL_CASH) / INITIAL_CASH * 100
}

// ─── COMPONENTS ───────────────────────────────────────────────

function ProgressBar({ value, max, color, height = 6, animate = false }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div style={{ height, background: 'rgba(255,255,255,0.08)', borderRadius: height/2, overflow:'hidden' }}>
      <div style={{
        height: '100%', width: `${pct}%`, background: color,
        borderRadius: height/2,
        transition: animate ? 'width 1s ease' : 'none'
      }} />
    </div>
  )
}

function MiniChart({ data, color, width=80, height=32 }) {
  if (!data || data.length < 2) return <div style={{width,height}} />
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pad = 3
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length-1)) * (width - 2*pad)
    const y = height - pad - ((v-min)/range)*(height-2*pad)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Badge({ text, color }) {
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 8, fontSize: 10, fontWeight: 700,
      background: `${color}20`, color, border: `1px solid ${color}40`
    }}>{text}</span>
  )
}

function LiveDot({ color = '#10b981' }) {
  return (
    <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', background:color, marginRight:5, animation:'pulse 1.5s ease-in-out infinite' }} />
  )
}

// ─── SETUP SCREEN ─────────────────────────────────────────────
function SetupScreen({ onSave }) {
  const [keys, setKeys] = useState({ claudeKey:'', gptKey:'', geminiKey:'', deepseekKey:'' })
  const [show, setShow] = useState({})

  const fields = [
    { key:'claudeKey',    label:'Claude (Anthropic)',  placeholder:'sk-ant-api03-...', color:'#f59e0b' },
    { key:'gptKey',       label:'GPT-4 (OpenAI)',      placeholder:'sk-...', color:'#10b981' },
    { key:'geminiKey',    label:'Gemini (Google)',      placeholder:'AIza...', color:'#3b82f6' },
    { key:'deepseekKey',  label:'DeepSeek',             placeholder:'sk-...', color:'#8b5cf6' },
  ]

  const filled = Object.values(keys).filter(Boolean).length

  return (
    <div style={{ height:'100%', overflowY:'auto', padding:'24px 20px', display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ textAlign:'center', paddingTop:20 }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🏆</div>
        <div style={{ fontSize:24, fontWeight:900, background:'linear-gradient(135deg,#f59e0b,#ef4444)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
          AI投资竞技场
        </div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', marginTop:8, lineHeight:1.6 }}>
          输入各AI的API Key，让它们用<br/>真实数据自由竞技，10万→100万
        </div>
      </div>

      <div style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.25)', borderRadius:14, padding:'12px 16px', fontSize:12, color:'rgba(245,158,11,0.9)', lineHeight:1.7 }}>
        💡 至少填1个Key即可开始。Key仅存储在你的设备本地，不会上传任何服务器。未填写的AI将跳过决策。
      </div>

      {fields.map(f => (
        <div key={f.key}>
          <div style={{ fontSize:13, fontWeight:700, color:f.color, marginBottom:8 }}>{f.label}</div>
          <div style={{ position:'relative' }}>
            <input
              type={show[f.key] ? 'text' : 'password'}
              value={keys[f.key]}
              onChange={e => setKeys(k => ({...k, [f.key]: e.target.value}))}
              placeholder={f.placeholder}
              style={{
                width:'100%', padding:'12px 44px 12px 14px',
                background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)',
                borderRadius:12, color:'#fff', fontSize:13, outline:'none',
              }}
            />
            <button onClick={() => setShow(s => ({...s, [f.key]: !s[f.key]}))}
              style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'rgba(255,255,255,0.4)', cursor:'pointer', fontSize:16 }}>
              {show[f.key] ? '🙈' : '👁'}
            </button>
          </div>
        </div>
      ))}

      <button
        onClick={() => filled > 0 && onSave(keys)}
        style={{
          width:'100%', padding:'15px',
          background: filled > 0 ? 'linear-gradient(135deg,#f59e0b,#ef4444)' : 'rgba(255,255,255,0.1)',
          border:'none', borderRadius:14, color:'#fff', fontSize:16, fontWeight:900, cursor: filled > 0 ? 'pointer' : 'not-allowed',
          marginTop:8
        }}>
        {filled === 0 ? '请至少填写一个Key' : `开始竞技 (已配置 ${filled}/4 个AI) 🚀`}
      </button>

      <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', textAlign:'center', lineHeight:1.8, paddingBottom:20 }}>
        获取Key教程：<br/>
        Claude → console.anthropic.com<br/>
        GPT → platform.openai.com<br/>
        Gemini → aistudio.google.com<br/>
        DeepSeek → platform.deepseek.com
      </div>
    </div>
  )
}

// ─── LEADERBOARD ──────────────────────────────────────────────
function Leaderboard({ appState, onSelectAI }) {
  const { aiStates, stockPrices, tradeDay } = appState

  const ranked = AI_PROFILES
    .map(p => {
      const s = aiStates[p.id]
      const val = totalValue(s, stockPrices)
      const pct = profitPct(s, stockPrices)
      return { ...p, aiState: s, val, pct }
    })
    .sort((a,b) => b.val - a.val)

  const leader = ranked[0]
  const progressToTarget = (leader.val / TARGET) * 100

  return (
    <div style={{ padding:'16px', overflowY:'auto', height:'100%' }}>
      {/* Header */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
          <LiveDot />
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)', letterSpacing:2 }}>LIVE · 第{tradeDay}交易日</span>
        </div>
        <div style={{ fontSize:22, fontWeight:900 }}>AI投资竞技场</div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginTop:2 }}>目标：¥1,000,000 · 初始：¥100,000</div>
      </div>

      {/* Target progress */}
      <div style={{ background:'linear-gradient(135deg,rgba(245,158,11,0.1),rgba(239,68,68,0.1))', border:'1px solid rgba(245,158,11,0.2)', borderRadius:16, padding:'14px 16px', marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
          <span style={{ fontSize:12, color:'rgba(255,255,255,0.6)' }}>🏆 领先者进度</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#f59e0b' }}>{leader.avatar} {leader.name}</span>
        </div>
        <ProgressBar value={leader.val} max={TARGET} color="linear-gradient(90deg,#f59e0b,#ef4444)" height={8} animate />
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>¥{fmtMoney(leader.val)}</span>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{progressToTarget.toFixed(1)}% 完成</span>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>¥100万</span>
        </div>
      </div>

      {/* Rankings */}
      <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', letterSpacing:2, marginBottom:10 }}>RANKINGS</div>
      {ranked.map((ai, idx) => {
        const medals = ['🥇','🥈','🥉','4️⃣']
        const isPositive = ai.pct >= 0
        const chartData = ai.aiState.priceHistory.map(h => h.totalValue)
        return (
          <div key={ai.id} onClick={() => onSelectAI(ai.id)}
            style={{ background:'rgba(255,255,255,0.03)', border:`1px solid ${ai.color}30`, borderRadius:16, padding:'14px 16px', marginBottom:10, cursor:'pointer', transition:'all 0.2s', animation:'fadeIn 0.3s ease' }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ fontSize:24, lineHeight:1 }}>{medals[idx]}</div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:16, fontWeight:800 }}>{ai.name}</span>
                  <Badge text={ai.label} color={ai.color} />
                  {ai.aiState.thinking && <span style={{ fontSize:10, color:ai.color, animation:'pulse 1s infinite' }}>思考中...</span>}
                </div>
                <div style={{ fontSize:20, fontWeight:900, marginBottom:2 }}>
                  ¥{ai.val.toLocaleString('zh', {maximumFractionDigits:0})}
                </div>
                <div style={{ fontSize:13, fontWeight:700, color: isPositive ? '#10b981' : '#ef4444' }}>
                  {fmtPct(ai.pct)}
                  <span style={{ fontSize:11, color:'rgba(255,255,255,0.3)', fontWeight:400, marginLeft:8 }}>vs初始</span>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8 }}>
                <MiniChart data={chartData.length > 1 ? chartData : [INITIAL_CASH, ai.val]} color={isPositive ? '#10b981' : '#ef4444'} />
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)' }}>
                  {ai.aiState.totalTrades}笔交易
                </div>
              </div>
            </div>
            {/* Progress to target */}
            <div style={{ marginTop:12 }}>
              <ProgressBar value={ai.val} max={TARGET} color={ai.color} height={4} animate />
            </div>
          </div>
        )
      })}

      <div style={{ height:20 }} />
    </div>
  )
}

// ─── AI DETAIL PAGE ───────────────────────────────────────────
function AIDetail({ aiId, appState, onBack, onTriggerDecision }) {
  const profile = AI_PROFILES.find(p => p.id === aiId)
  const { aiStates, stockPrices, stockMeta } = appState
  const ai = aiStates[aiId]
  const val = totalValue(ai, stockPrices)
  const pct = profitPct(ai, stockPrices)
  const [tab, setTab] = useState('holdings') // holdings | trades | summary

  const holdingsList = Object.entries(ai.holdings).filter(([,h]) => h.qty > 0).map(([code, h]) => {
    const cur = stockPrices[code] || h.avgCost
    const gainPct = (cur - h.avgCost) / h.avgCost * 100
    const mktVal  = cur * h.qty
    return { code, ...h, cur, gainPct, mktVal }
  }).sort((a,b) => b.mktVal - a.mktVal)

  const cashPct = (ai.cash / val) * 100

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div style={{ padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
        <button onClick={onBack} style={{ background:'rgba(255,255,255,0.07)', border:'none', borderRadius:9, padding:'6px 12px', color:'rgba(255,255,255,0.7)', cursor:'pointer', fontSize:13, marginBottom:12 }}>
          ← 返回
        </button>
        <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
          <div style={{ fontSize:36 }}>{profile.avatar}</div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <span style={{ fontSize:20, fontWeight:900 }}>{profile.name}</span>
              <Badge text={profile.label} color={profile.color} />
            </div>
            <div style={{ fontSize:24, fontWeight:900 }}>
              ¥{val.toLocaleString('zh', {maximumFractionDigits:0})}
            </div>
            <div style={{ fontSize:14, fontWeight:700, color: pct >= 0 ? '#10b981' : '#ef4444', marginTop:2 }}>
              {fmtPct(pct)}
              <span style={{ fontSize:11, color:'rgba(255,255,255,0.3)', fontWeight:400, marginLeft:8 }}>
                胜率 {ai.totalTrades > 0 ? ((ai.wins/ai.totalTrades)*100).toFixed(0) : 0}%
              </span>
            </div>
          </div>
          <button onClick={() => onTriggerDecision(aiId)}
            disabled={ai.thinking}
            style={{ padding:'8px 14px', background: ai.thinking ? 'rgba(255,255,255,0.06)' : `${profile.color}22`, border:`1px solid ${profile.color}44`, borderRadius:10, color: ai.thinking ? 'rgba(255,255,255,0.3)' : profile.color, fontSize:12, fontWeight:700, cursor: ai.thinking ? 'not-allowed' : 'pointer' }}>
            {ai.thinking ? '思考中...' : '触发决策'}
          </button>
        </div>
        {/* Holding bar */}
        <div style={{ marginTop:12, display:'flex', gap:4, height:6, borderRadius:3, overflow:'hidden' }}>
          {holdingsList.map(h => (
            <div key={h.code} style={{ flex: h.mktVal, background: h.gainPct >= 0 ? '#10b981' : '#ef4444', transition:'flex 0.5s ease' }} title={h.name} />
          ))}
          <div style={{ flex: ai.cash, background: 'rgba(255,255,255,0.15)' }} title="现金" />
        </div>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginTop:4 }}>
          现金 {cashPct.toFixed(0)}% · 持仓 {holdingsList.length} 只
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
        {[['holdings','持仓'],['trades','交易记录'],['summary','策略报告']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ flex:1, padding:'10px', background:'none', border:'none', color: tab===key ? profile.color : 'rgba(255,255,255,0.4)', fontSize:13, fontWeight: tab===key ? 700 : 400, cursor:'pointer', borderBottom:`2px solid ${tab===key ? profile.color : 'transparent'}`, transition:'all 0.2s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px' }}>

        {tab === 'holdings' && (
          <>
            {holdingsList.length === 0 ? (
              <div style={{ textAlign:'center', padding:'40px 0', color:'rgba(255,255,255,0.3)' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>💼</div>
                <div>暂无持仓，全部现金</div>
              </div>
            ) : holdingsList.map(h => (
              <div key={h.code} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, padding:'14px', marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
                      <span style={{ fontSize:15, fontWeight:800 }}>{h.name || STOCK_NAMES[h.code] || h.code}</span>
                      <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>{h.code}</span>
                    </div>
                    <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)' }}>
                      {h.qty}股 · 成本¥{h.avgCost.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:16, fontWeight:800 }}>¥{h.cur.toFixed(2)}</div>
                    <div style={{ fontSize:13, fontWeight:700, color: h.gainPct >= 0 ? '#10b981' : '#ef4444' }}>
                      {fmtPct(h.gainPct)}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop:10, display:'flex', justifyContent:'space-between', fontSize:12, color:'rgba(255,255,255,0.4)' }}>
                  <span>市值 ¥{fmtMoney(h.mktVal)}</span>
                  <span>盈亏 <span style={{ color: h.gainPct >= 0 ? '#10b981' : '#ef4444', fontWeight:700 }}>
                    {h.gainPct >= 0 ? '+' : ''}¥{((h.cur - h.avgCost)*h.qty).toFixed(0)}
                  </span></span>
                </div>
              </div>
            ))}
            {/* Cash card */}
            <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, padding:'14px', marginBottom:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>💵 可用现金</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)' }}>等待买入机会</div>
                </div>
                <div style={{ fontSize:18, fontWeight:900 }}>¥{fmtMoney(ai.cash)}</div>
              </div>
            </div>
          </>
        )}

        {tab === 'trades' && (
          <>
            {ai.trades.length === 0 ? (
              <div style={{ textAlign:'center', padding:'40px 0', color:'rgba(255,255,255,0.3)' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
                <div>暂无交易记录</div>
              </div>
            ) : [...ai.trades].reverse().map((t, i) => (
              <div key={i} style={{ background:'rgba(255,255,255,0.03)', border:`1px solid ${t.action==='buy' ? 'rgba(16,185,129,0.15)' : t.action==='sell' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.07)'}`, borderRadius:12, padding:'12px 14px', marginBottom:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <span style={{ fontSize:16, fontWeight:800, color: t.action==='buy' ? '#10b981' : t.action==='sell' ? '#ef4444' : 'rgba(255,255,255,0.5)' }}>
                      {t.action==='buy' ? '买入' : t.action==='sell' ? '卖出' : '观望'}
                    </span>
                    {t.stockName && <span style={{ fontSize:14, fontWeight:700 }}>{t.stockName}</span>}
                  </div>
                  <span style={{ fontSize:11, color:'rgba(255,255,255,0.35)' }}>Day {t.day}</span>
                </div>
                {t.qty > 0 && (
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginBottom:6 }}>
                    {t.qty}股 @ ¥{t.price?.toFixed(2)} · ¥{fmtMoney(t.amount || 0)}
                  </div>
                )}
                {t.reason && (
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.6)', lineHeight:1.6, background:'rgba(255,255,255,0.03)', borderRadius:8, padding:'8px 10px' }}>
                    "{t.reason}"
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'summary' && (
          <>
            {!ai.summary ? (
              <div style={{ textAlign:'center', padding:'40px 0', color:'rgba(255,255,255,0.3)' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
                <div>触发一次决策后生成策略报告</div>
              </div>
            ) : (
              <>
                <div style={{ background:`${profile.color}0f`, border:`1px solid ${profile.color}30`, borderRadius:16, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:12, color:profile.color, fontWeight:700, letterSpacing:1, marginBottom:10 }}>📈 策略复盘</div>
                  <div style={{ fontSize:13, lineHeight:1.8, color:'rgba(255,255,255,0.8)' }}>{ai.summary.review}</div>
                </div>
                <div style={{ background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:16, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:12, color:'#ef4444', fontWeight:700, letterSpacing:1, marginBottom:10 }}>🔍 自我反思</div>
                  <div style={{ fontSize:13, lineHeight:1.8, color:'rgba(255,255,255,0.8)' }}>{ai.summary.reflection}</div>
                </div>
                <div style={{ background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.2)', borderRadius:16, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:12, color:'#3b82f6', fontWeight:700, letterSpacing:1, marginBottom:10 }}>🔮 下阶段预判</div>
                  <div style={{ fontSize:13, lineHeight:1.8, color:'rgba(255,255,255,0.8)' }}>{ai.summary.forecast}</div>
                </div>
                {ai.summaryHistory.length > 1 && (
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.35)', textAlign:'center', marginTop:8 }}>
                    共 {ai.summaryHistory.length} 份历史报告
                  </div>
                )}
              </>
            )}
          </>
        )}
        <div style={{ height:20 }} />
      </div>
    </div>
  )
}

// ─── THINKING OVERLAY ─────────────────────────────────────────
function ThinkingOverlay({ aiId, step, decision }) {
  const profile = AI_PROFILES.find(p => p.id === aiId)
  if (!profile) return null

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
      animation:'fadeIn 0.2s ease'
    }}>
      <div style={{ background:'#111827', border:`1px solid ${profile.color}40`, borderRadius:20, padding:24, width:'100%', maxWidth:380 }}>
        <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:20 }}>
          <div style={{ fontSize:36 }}>{profile.avatar}</div>
          <div>
            <div style={{ fontSize:16, fontWeight:800 }}>{profile.name}</div>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
              <LiveDot color={profile.color} />
              <span style={{ fontSize:12, color:profile.color }}>正在分析市场...</span>
            </div>
          </div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
          {['获取实时股票数据','分析基本面指标','评估当前持仓','制定操作方案'].map((s, i) => (
            <div key={i} style={{ display:'flex', gap:10, alignItems:'center', opacity: step > i ? 1 : 0.3, transition:'opacity 0.3s ease' }}>
              <div style={{ width:20, height:20, borderRadius:'50%', background: step > i ? `${profile.color}22` : 'rgba(255,255,255,0.05)', border:`1px solid ${step > i ? profile.color : 'rgba(255,255,255,0.1)'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:profile.color, flexShrink:0 }}>
                {step > i ? '✓' : i+1}
              </div>
              <span style={{ fontSize:13, color: step > i ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)' }}>{s}</span>
            </div>
          ))}
        </div>

        {decision && (
          <div style={{ background:`${profile.color}0f`, border:`1px solid ${profile.color}30`, borderRadius:14, padding:16, animation:'fadeIn 0.4s ease' }}>
            <div style={{ fontSize:12, color:profile.color, fontWeight:700, marginBottom:10 }}>📌 决策结果</div>
            <div style={{ fontSize:16, fontWeight:900, marginBottom:8, color:
              decision.action==='buy' ? '#10b981' : decision.action==='sell' ? '#ef4444' : 'rgba(255,255,255,0.6)'
            }}>
              {decision.action==='buy' ? '🟢 买入' : decision.action==='sell' ? '🔴 卖出' : '⏸ 观望'}
              {decision.stockName && ` ${decision.stockName}`}
            </div>
            {decision.qty > 0 && (
              <div style={{ fontSize:13, color:'rgba(255,255,255,0.7)', marginBottom:8 }}>
                {decision.qty}股 @ ¥{decision.price?.toFixed(2)} · ¥{fmtMoney((decision.qty*decision.price)||0)}
              </div>
            )}
            {decision.reason && (
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.6)', lineHeight:1.7 }}>"{decision.reason}"</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── COMPARE PAGE ─────────────────────────────────────────────
function ComparePage({ appState }) {
  const { aiStates, stockPrices, tradeDay } = appState

  const stats = AI_PROFILES.map(p => {
    const s = aiStates[p.id]
    const val = totalValue(s, stockPrices)
    const pct = profitPct(s, stockPrices)
    const winRate = s.totalTrades > 0 ? (s.wins / s.totalTrades * 100) : 0
    const holdCount = Object.values(s.holdings).filter(h => h.qty > 0).length
    return { ...p, val, pct, winRate, holdCount, trades: s.totalTrades, cash: s.cash }
  })

  const metrics = [
    { label:'总资产', key:'val', fmt: v => `¥${fmtMoney(v)}`, higher:true },
    { label:'收益率', key:'pct', fmt: v => fmtPct(v), higher:true },
    { label:'胜率',   key:'winRate', fmt: v => `${v.toFixed(0)}%`, higher:true },
    { label:'交易次数',key:'trades', fmt: v => `${v}次`, higher:false },
    { label:'持仓数', key:'holdCount', fmt: v => `${v}只`, higher:false },
    { label:'现金',   key:'cash', fmt: v => `¥${fmtMoney(v)}`, higher:false },
  ]

  return (
    <div style={{ padding:'16px', overflowY:'auto', height:'100%' }}>
      <div style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>数据对比</div>
      <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', marginBottom:20 }}>第{tradeDay}交易日 · 全方位比较</div>

      {metrics.map(m => {
        const vals = stats.map(s => s[m.key])
        const best = m.higher ? Math.max(...vals) : Math.min(...vals.filter(v=>v>0))
        return (
          <div key={m.key} style={{ marginBottom:20 }}>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', letterSpacing:1, marginBottom:10 }}>{m.label}</div>
            {stats.map(s => {
              const v = s[m.key]
              const isBest = v === best
              const pct = m.key === 'val' ? (v / TARGET * 100) : m.key === 'pct' ? Math.min(Math.max((v+20)/120*100,2),100) : m.key === 'winRate' ? v : 50
              return (
                <div key={s.id} style={{ marginBottom:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:12, color:'rgba(255,255,255,0.6)', display:'flex', alignItems:'center', gap:6 }}>
                      {s.avatar} {s.name} {isBest && <span style={{ fontSize:10, color:s.color }}>👑</span>}
                    </span>
                    <span style={{ fontSize:13, fontWeight:700, color: isBest ? s.color : 'rgba(255,255,255,0.8)' }}>
                      {m.fmt(v)}
                    </span>
                  </div>
                  <ProgressBar value={pct} max={100} color={isBest ? s.color : 'rgba(255,255,255,0.15)'} height={5} animate />
                </div>
              )
            })}
          </div>
        )
      })}
      <div style={{ height:20 }} />
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [appState, setAppState] = useState(() => {
    const saved = loadState()
    return saved || initState()
  })
  const [screen, setScreen] = useState('arena') // arena | detail | compare | settings
  const [selectedAI, setSelectedAI] = useState(null)
  const [thinking, setThinking] = useState(null) // { aiId, step, decision }
  const [toast, setToast] = useState(null)
  const fetchingRef = useRef(false)

  // Save whenever state changes
  useEffect(() => { saveState(appState) }, [appState])

  const showToast = (msg, color='#10b981') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  // Fetch real stock prices
  const refreshPrices = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const allCodes = [...new Set(Object.values(SECTORS).flat())]
      const results  = await fetchMultipleStocks(allCodes)
      const newPrices = {}
      const newMeta   = {}
      for (const code of allCodes) {
        const name = STOCK_NAMES[code] || code
        if (results[code]) {
          newPrices[code] = results[code].price
          newMeta[code]   = { name, change: results[code].change }
        } else {
          // Use fallback
          newPrices[code] = FALLBACK_PRICES[code] || 10
          newMeta[code]   = { name, change: (Math.random()-0.5)*3 }
        }
      }
      setAppState(s => ({ ...s, stockPrices: newPrices, stockMeta: newMeta }))
    } catch (e) {
      console.error('Price fetch failed', e)
    } finally {
      fetchingRef.current = false
    }
  }, [])

  // Initial price fetch
  useEffect(() => { refreshPrices() }, [])

  // Periodic refresh every 60s
  useEffect(() => {
    const t = setInterval(refreshPrices, 60000)
    return () => clearInterval(t)
  }, [refreshPrices])

  // Build market context string for AI
  function buildMarketContext(aiState) {
    const { stockPrices, stockMeta, tradeDay } = appState
    const val = totalValue(aiState, stockPrices)
    const pct = profitPct(aiState, stockPrices)

    const holdingsSummary = Object.entries(aiState.holdings)
      .filter(([,h]) => h.qty > 0)
      .map(([code, h]) => {
        const cur = stockPrices[code] || h.avgCost
        const gainPct = ((cur - h.avgCost)/h.avgCost*100).toFixed(1)
        return `${h.name||STOCK_NAMES[code]||code}(${code}): ${h.qty}股, 成本¥${h.avgCost.toFixed(2)}, 现价¥${cur.toFixed(2)}, 盈亏${gainPct}%`
      }).join('\n')

    const stockList = Object.entries(SECTORS).map(([sector, codes]) => {
      const stocks = codes.map(code => {
        const p = stockPrices[code] || FALLBACK_PRICES[code] || 0
        const m = stockMeta[code] || {}
        return `  ${STOCK_NAMES[code]||code}(${code}): ¥${p.toFixed(2)} (${m.change >= 0 ? '+' : ''}${(m.change||0).toFixed(2)}%)`
      }).join('\n')
      return `【${sector}板块】\n${stocks}`
    }).join('\n')

    return `
=== 当前状态（第${tradeDay}交易日）===
账户总值：¥${val.toLocaleString('zh', {maximumFractionDigits:0})}
初始资金：¥${INITIAL_CASH.toLocaleString()}
目标资金：¥${TARGET.toLocaleString()}
当前收益：${pct.toFixed(2)}%
可用现金：¥${aiState.cash.toLocaleString('zh', {maximumFractionDigits:0})}
历史交易：${aiState.totalTrades}次，胜${aiState.wins}负${aiState.losses}

=== 当前持仓 ===
${holdingsSummary || '无持仓，全部现金'}

=== 实时行情（所有可选股票）===
${stockList}

=== 任务 ===
请分析当前市场和持仓，做出一个投资决策。
你可以：买入某只股票、卖出某只持仓、或者选择观望。
如果买入，请指定股票代码和数量（每手100股）。
如果卖出，请指定股票代码和数量。

请用以下JSON格式回复（只回复JSON，不要其他文字）：
{
  "action": "buy" 或 "sell" 或 "hold",
  "stock_code": "股票代码（action为hold时可省略）",
  "quantity": 数量（股，100的倍数）,
  "price": 预期成交价（用现价即可）,
  "reason": "你的分析理由（100-200字）",
  "stop_loss_pct": 止损百分比（如8表示-8%）,
  "review": "对最近持仓表现的复盘（50字）",
  "reflection": "自我反思，哪里做得不好（50字）",
  "forecast": "对未来3-5天的预判（50字）"
}
`
  }

  // Execute AI decision
  async function executeDecision(aiId, decisionRaw, rawText) {
    const profile = AI_PROFILES.find(p => p.id === aiId)
    setAppState(s => {
      const ai = { ...s.aiStates[aiId] }
      const prices = s.stockPrices
      const day = s.tradeDay + 1

      // Build summary from decision fields
      const summary = {
        review:     decisionRaw.review     || '暂无复盘',
        reflection: decisionRaw.reflection || '暂无反思',
        forecast:   decisionRaw.forecast   || '暂无预判',
        date:       new Date().toLocaleString('zh')
      }

      let trade = {
        day,
        action:    decisionRaw.action,
        stockCode: decisionRaw.stock_code,
        stockName: STOCK_NAMES[decisionRaw.stock_code] || decisionRaw.stock_code,
        qty:       0,
        price:     0,
        amount:    0,
        reason:    decisionRaw.reason || rawText?.slice(0,200),
      }

      if (decisionRaw.action === 'buy' && decisionRaw.stock_code && decisionRaw.quantity > 0) {
        const code  = decisionRaw.stock_code
        const price = prices[code] || FALLBACK_PRICES[code] || decisionRaw.price || 10
        const qty   = Math.max(100, Math.round(decisionRaw.quantity / 100) * 100)
        const cost  = price * qty
        if (cost <= ai.cash && cost > 0) {
          const existing = ai.holdings[code]
          if (existing && existing.qty > 0) {
            const totalQty  = existing.qty + qty
            const avgCost   = (existing.avgCost * existing.qty + price * qty) / totalQty
            ai.holdings = { ...ai.holdings, [code]: { qty: totalQty, avgCost, name: STOCK_NAMES[code] || code } }
          } else {
            ai.holdings = { ...ai.holdings, [code]: { qty, avgCost: price, name: STOCK_NAMES[code] || code } }
          }
          ai.cash -= cost
          trade = { ...trade, qty, price, amount: cost }
          ai.totalTrades++
        }
      } else if (decisionRaw.action === 'sell' && decisionRaw.stock_code) {
        const code     = decisionRaw.stock_code
        const holding  = ai.holdings[code]
        if (holding && holding.qty > 0) {
          const price    = prices[code] || FALLBACK_PRICES[code] || holding.avgCost
          const qty      = Math.min(decisionRaw.quantity || holding.qty, holding.qty)
          const proceeds = price * qty
          const gainPct  = (price - holding.avgCost) / holding.avgCost * 100
          ai.holdings = { ...ai.holdings, [code]: { ...holding, qty: holding.qty - qty } }
          ai.cash += proceeds
          trade = { ...trade, qty, price, amount: proceeds }
          ai.totalTrades++
          if (gainPct > 0) { ai.wins++ } else { ai.losses++ }
        }
      }

      const val = totalValue(ai, prices)
      ai.trades = [...ai.trades, trade]
      ai.priceHistory = [...ai.priceHistory, { date: new Date().toISOString(), totalValue: val }]
      ai.summary = summary
      ai.summaryHistory = [...ai.summaryHistory, summary]
      ai.lastTradeDay = day
      ai.thinking = false

      return {
        ...s,
        tradeDay: day,
        aiStates: { ...s.aiStates, [aiId]: ai }
      }
    })
  }

  // Trigger AI decision
  async function triggerDecision(aiId) {
    const profile = AI_PROFILES.find(p => p.id === aiId)
    const apiKey  = appState.apiKeys[profile.apiKeyName]
    if (!apiKey) {
      showToast(`${profile.name} 未配置API Key`, '#ef4444')
      return
    }

    setAppState(s => ({ ...s, aiStates: { ...s.aiStates, [aiId]: { ...s.aiStates[aiId], thinking: true } } }))
    setThinking({ aiId, step: 1, decision: null })

    try {
      const aiState = appState.aiStates[aiId]
      await new Promise(r => setTimeout(r, 600))
      setThinking(t => ({ ...t, step: 2 }))
      await new Promise(r => setTimeout(r, 600))
      setThinking(t => ({ ...t, step: 3 }))

      const context = buildMarketContext(aiState)
      const rawText = await callAI(profile, apiKey, profile.personality, context)

      setThinking(t => ({ ...t, step: 4 }))
      await new Promise(r => setTimeout(r, 400))

      const decision = parseAIResponse(rawText)
      if (decision) {
        const stockName = STOCK_NAMES[decision.stock_code] || decision.stock_code
        setThinking(t => ({ ...t, decision: { ...decision, stockName, price: appState.stockPrices[decision.stock_code] || FALLBACK_PRICES[decision.stock_code] || 0 } }))
        await new Promise(r => setTimeout(r, 2000))
        await executeDecision(aiId, decision, rawText)
        showToast(`${profile.name} 完成决策！`, profile.color)
      } else {
        showToast(`${profile.name} 决策解析失败`, '#ef4444')
        setAppState(s => ({ ...s, aiStates: { ...s.aiStates, [aiId]: { ...s.aiStates[aiId], thinking: false } } }))
      }
    } catch (e) {
      console.error(e)
      showToast(`${profile.name} 调用失败: ${e.message}`, '#ef4444')
      setAppState(s => ({ ...s, aiStates: { ...s.aiStates, [aiId]: { ...s.aiStates[aiId], thinking: false } } }))
    } finally {
      setTimeout(() => setThinking(null), 500)
    }
  }

  // Trigger all AIs
  async function triggerAll() {
    for (const p of AI_PROFILES) {
      if (appState.apiKeys[p.apiKeyName]) {
        await triggerDecision(p.id)
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  if (!appState.configDone) {
    return (
      <div style={{ width:'100%', maxWidth:430, margin:'0 auto', height:'100vh', background:'#0a0e1a', color:'#fff', overflow:'hidden', position:'relative' }}>
        <SetupScreen onSave={keys => setAppState(s => ({ ...s, apiKeys: keys, configDone: true }))} />
      </div>
    )
  }

  return (
    <div style={{ width:'100%', maxWidth:430, margin:'0 auto', height:'100vh', background:'#0a0e1a', color:'#fff', display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
      {/* Ambient */}
      <div style={{ position:'fixed', top:-80, right:-80, width:220, height:220, background:'radial-gradient(circle,rgba(245,158,11,0.05),transparent)', borderRadius:'50%', pointerEvents:'none' }} />
      <div style={{ position:'fixed', bottom:-80, left:-60, width:200, height:200, background:'radial-gradient(circle,rgba(59,130,246,0.05),transparent)', borderRadius:'50%', pointerEvents:'none' }} />

      {/* Top bar */}
      <div style={{ padding:'12px 16px 0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize:16, fontWeight:900, background:'linear-gradient(135deg,#f59e0b,#ef4444)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
          AI竞技场
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={refreshPrices} style={{ background:'rgba(255,255,255,0.07)', border:'none', borderRadius:8, padding:'6px 10px', color:'rgba(255,255,255,0.6)', cursor:'pointer', fontSize:13 }}>
            🔄
          </button>
          <button onClick={triggerAll} style={{ background:'linear-gradient(135deg,rgba(245,158,11,0.2),rgba(239,68,68,0.2))', border:'1px solid rgba(245,158,11,0.3)', borderRadius:8, padding:'6px 12px', color:'#f59e0b', cursor:'pointer', fontSize:12, fontWeight:700 }}>
            全部决策
          </button>
          <button onClick={() => { setAppState(s => ({ ...s, configDone:false })) }} style={{ background:'rgba(255,255,255,0.07)', border:'none', borderRadius:8, padding:'6px 10px', color:'rgba(255,255,255,0.6)', cursor:'pointer', fontSize:13 }}>
            ⚙️
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
        {[['arena','🏆 排行'],['compare','📊 对比']].map(([key, label]) => (
          <button key={key} onClick={() => { setScreen(key); setSelectedAI(null) }}
            style={{ flex:1, padding:'10px', background:'none', border:'none', color: screen===key ? '#f59e0b' : 'rgba(255,255,255,0.4)', fontSize:13, fontWeight: screen===key ? 700:400, cursor:'pointer', borderBottom:`2px solid ${screen===key ? '#f59e0b' : 'transparent'}`, transition:'all 0.2s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflow:'hidden', position:'relative', zIndex:1 }}>
        {screen === 'arena' && !selectedAI && (
          <Leaderboard appState={appState} onSelectAI={id => { setSelectedAI(id); setScreen('detail') }} />
        )}
        {screen === 'detail' && selectedAI && (
          <AIDetail aiId={selectedAI} appState={appState} onBack={() => { setSelectedAI(null); setScreen('arena') }} onTriggerDecision={triggerDecision} />
        )}
        {screen === 'compare' && (
          <ComparePage appState={appState} />
        )}
      </div>

      {/* Thinking overlay */}
      {thinking && (
        <ThinkingOverlay aiId={thinking.aiId} step={thinking.step} decision={thinking.decision} />
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:70, left:'50%', transform:'translateX(-50%)', background:toast.color, color:'#fff', padding:'10px 20px', borderRadius:20, fontWeight:700, fontSize:13, zIndex:2000, whiteSpace:'nowrap', boxShadow:'0 4px 20px rgba(0,0,0,0.5)', animation:'fadeIn 0.2s ease' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
