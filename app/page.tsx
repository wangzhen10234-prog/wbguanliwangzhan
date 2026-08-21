"use client";

import { useEffect, useState } from "react";

const allBars = [34, 46, 39, 55, 49, 63, 57, 42, 57, 48, 72, 64, 77, 69, 92, 74, 81, 88, 70, 79, 96];

const products = [
  { name: "Женская базовая футболка", sku: "WB-24018", category: "女装", sales: "₽ 286,420", orders: 438, rate: "18.7%", tone: "lilac" },
  { name: "Органайзер для кухни", sku: "WB-18392", category: "家居", sales: "₽ 214,880", orders: 316, rate: "15.2%", tone: "blue" },
  { name: "Рюкзак городской унисекс", sku: "WB-30106", category: "箱包", sales: "₽ 176,250", orders: 205, rate: "12.9%", tone: "orange" },
  { name: "Набор полотенец 4 шт.", sku: "WB-22047", category: "家纺", sales: "₽ 129,740", orders: 188, rate: "11.4%", tone: "mint" },
];

const ranges = {
  "7": { label: "近 7 天", date: "8月 15日 — 8月 21日", sales: "₽ 486,310", shortSales: "₽486K", orders: "692", profit: "₽ 121,840", returns: "7.2%", average: "₽ 69,473", peak: "₽ 108,420" },
  "14": { label: "近 14 天", date: "8月 8日 — 8月 21日", sales: "₽ 892,760", shortSales: "₽893K", orders: "1,284", profit: "₽ 227,190", returns: "7.5%", average: "₽ 63,769", peak: "₽ 108,420" },
  "21": { label: "近 21 天", date: "8月 1日 — 8月 21日", sales: "₽ 1,284,620", shortSales: "₽1.28M", orders: "1,847", profit: "₽ 326,480", returns: "7.8%", average: "₽ 61,172", peak: "₽ 108,420" },
} as const;

type RangeKey = keyof typeof ranges;

export default function Home() {
  const [range, setRange] = useState<RangeKey>("21");
  const [showConnect, setShowConnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const active = ranges[range];
  const bars = allBars.slice(-Number(range));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setShowConnect(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  function exportCsv() {
    const header = ["商品名称", "SKU", "类目", "销售额(卢布)", "订单数", "转化率"];
    const rows = products.map((item) => [item.name, item.sku, item.category, item.sales.replace(/[^0-9]/g, ""), item.orders, item.rate]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wb-insight-${range}days.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyChecklist() {
    await navigator.clipboard.writeText("Wildberries API 接入所需：1. API 文档或接口地址；2. 鉴权方式；3. 订单、商品、库存、财务接口样例返回；4. 数据同步频率。请勿在聊天中直接发送长期有效密钥。");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">W</span><div><strong>WB Insight</strong><small>俄罗斯店铺分析</small></div></div>
        <nav aria-label="主导航">
          <a className="nav-item active" href="#overview"><span>▦</span>经营总览</a>
          <a className="nav-item" href="#sales"><span>↗</span>销售分析</a>
          <a className="nav-item" href="#products"><span>◇</span>商品表现</a>
          <a className="nav-item" href="#stock"><span>□</span>库存监控<i>6</i></a>
          <a className="nav-item" href="#finance"><span>₽</span>利润与回款</a>
        </nav>
        <div className="nav-section">数据管理</div>
        <nav>
          <button className="nav-item nav-button" onClick={() => setShowConnect(true)}><span>↻</span>数据同步</button>
          <button className="nav-item nav-button" onClick={exportCsv}><span>↓</span>数据导出</button>
        </nav>
        <div className="sidebar-foot">
          <div className="sync-status"><span className="status-dot" /><div><b>API 等待接入</b><small>当前展示演示数据</small></div></div>
          <button className="connect-btn" onClick={() => setShowConnect(true)}>连接 WB 店铺</button>
        </div>
      </aside>

      <section className="workspace" id="overview">
        <header className="topbar">
          <div><p className="eyebrow">Панель продавца · Demo workspace</p><h1>经营总览</h1></div>
          <div className="top-actions">
            <button className="export-button" onClick={exportCsv}>↓ 导出 CSV</button>
            <label className="date-button"><span>◫</span><select value={range} onChange={(event) => setRange(event.target.value as RangeKey)} aria-label="选择分析周期"><option value="7">近 7 天</option><option value="14">近 14 天</option><option value="21">近 21 天</option></select><b>{active.date}</b></label>
            <div className="avatar">Z</div>
          </div>
        </header>

        <div className="notice">
          <div className="notice-icon">↻</div>
          <div><strong>连接 Wildberries API 后即可查看真实经营数据</strong><p>首版分析框架已经准备好，接入后将自动同步订单、商品、库存和财务数据。</p></div>
          <button onClick={() => setShowConnect(true)}>查看接入说明</button>
        </div>

        <section className="metric-grid" aria-label={`${active.label}核心经营指标`}>
          <article className="metric-card featured"><div className="metric-head"><span>销售额</span><i>↗</i></div><strong>{active.sales}</strong><div className="metric-foot"><span className="up">↑ 18.4%</span><small>较上期</small></div><div className="spark-bars">{bars.slice(-10).map((h,i)=><span key={i} style={{height: `${h}%`}} />)}</div></article>
          <article className="metric-card"><div className="metric-head"><span>订单数</span><i>⌑</i></div><strong>{active.orders}</strong><div className="metric-foot"><span className="up">↑ 12.6%</span><small>较上期</small></div><p className="metric-note">平均客单价 ₽ 696</p></article>
          <article className="metric-card"><div className="metric-head"><span>利润估算</span><i>₽</i></div><strong>{active.profit}</strong><div className="metric-foot"><span className="up">↑ 9.2%</span><small>利润率 25.4%</small></div><p className="metric-note">已扣除平台费与物流</p></article>
          <article className="metric-card"><div className="metric-head"><span>退货率</span><i>↩</i></div><strong>{active.returns}</strong><div className="metric-foot"><span className="down">↓ 1.3%</span><small>表现优于类目</small></div><p className="metric-note">退货原因接入后可下钻</p></article>
        </section>

        <section className="dashboard-grid" id="sales">
          <article className="panel sales-panel">
            <div className="panel-title"><div><h2>销售趋势</h2><p>{active.label}每日销售额表现</p></div><div className="legend"><span><i className="purple-dot" />销售额</span><span><i className="gray-dot" />订单</span></div></div>
            <div className="chart-wrap"><div className="y-axis"><span>₽120K</span><span>₽90K</span><span>₽60K</span><span>₽30K</span><span>₽0</span></div><div className="bar-chart">{bars.map((height, index) => <div className="bar-col" key={`${range}-${index}`}><span className={index === bars.length - 1 ? "bar current" : "bar"} style={{height: `${height}%`}} /><small>{index % (range === "21" ? 3 : 2) === 0 ? `${22 - bars.length + index}日` : ""}</small></div>)}</div></div>
            <div className="chart-summary"><span>本期日均销售额 <b>{active.average}</b></span><span>峰值 <b>{active.peak}</b></span></div>
          </article>
          <article className="panel category-panel"><div className="panel-title"><div><h2>类目贡献</h2><p>销售额占比</p></div><span className="panel-tag">演示</span></div><div className="donut" aria-label="女装42%，家居28%，箱包18%，其他12%"><div><b>{active.shortSales}</b><small>总销售额</small></div></div><div className="category-list"><div><span><i className="c1" />女装</span><b>42%</b></div><div><span><i className="c2" />家居</span><b>28%</b></div><div><span><i className="c3" />箱包</span><b>18%</b></div><div><span><i className="c4" />其他</span><b>12%</b></div></div></article>
        </section>

        <section className="bottom-grid">
          <article className="panel products-panel" id="products"><div className="panel-title"><div><h2>热销商品</h2><p>按销售额排序</p></div><button className="text-action" onClick={exportCsv}>导出明细 →</button></div><div className="table-wrap"><table><thead><tr><th>商品</th><th>销售额</th><th>订单</th><th>转化率</th></tr></thead><tbody>{products.map((product) => <tr key={product.sku}><td><div className={`product-thumb ${product.tone}`}>{product.category.slice(0,1)}</div><div><b>{product.name}</b><small>{product.sku} · {product.category}</small></div></td><td><b>{product.sales}</b></td><td>{product.orders}</td><td><span className="rate">{product.rate}</span></td></tr>)}</tbody></table></div></article>
          <article className="panel stock-panel" id="stock"><div className="panel-title"><div><h2>库存预警</h2><p>需要尽快处理</p></div><span className="alert-count">6 项</span></div><div className="stock-item"><div className="stock-icon urgent">!</div><div><b>3 个 SKU 即将缺货</b><p>预计可售不足 5 天</p></div><span>补货</span></div><div className="stock-item"><div className="stock-icon warning">↓</div><div><b>2 个 SKU 库存偏低</b><p>库存覆盖 6–10 天</p></div><span>查看</span></div><div className="stock-item"><div className="stock-icon calm">↗</div><div><b>1 个 SKU 周转过慢</b><p>近 30 天动销率低于 15%</p></div><span>分析</span></div><button className="stock-button" onClick={() => setShowConnect(true)}>接入库存数据</button></article>
        </section>
      </section>

      {showConnect && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowConnect(false)}><section className="connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title"><button className="modal-close" onClick={() => setShowConnect(false)} aria-label="关闭">×</button><div className="modal-mark">W</div><p className="modal-eyebrow">WB API CONNECTOR</p><h2 id="connect-title">接入您的 Wildberries 店铺</h2><p className="modal-lead">为了准确匹配您的 API，请先提供接口文档、鉴权方式和一份脱敏的返回样例。正式密钥会放在服务器安全配置中，不会暴露在网页里。</p><div className="api-needs"><div><span>01</span><p><b>接口信息</b><small>API 文档、Base URL、鉴权方式</small></p></div><div><span>02</span><p><b>数据范围</b><small>订单、商品、库存、广告、财务报表</small></p></div><div><span>03</span><p><b>同步规则</b><small>历史数据起始日期与更新频率</small></p></div></div><div className="modal-note"><b>建议先接入</b><span>订单 + 商品 + 库存 + 财务，这四类数据足够完成销售和利润首轮分析。</span></div><div className="modal-actions"><button className="secondary" onClick={copyChecklist}>{copied ? "已复制 ✓" : "复制接入清单"}</button><button className="primary" onClick={() => setShowConnect(false)}>知道了</button></div></section></div>}
    </main>
  );
}
