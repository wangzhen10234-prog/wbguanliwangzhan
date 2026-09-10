# WB Insight 迁移到 Supabase

## 目标架构

Supabase 承接 Postgres 数据库；网站页面和现有服务端 API 部署到独立的前端/全栈托管平台。推荐先使用用户自己的 Cloudflare Workers 账户托管当前 Vinext 应用，因为当前代码和图片优化、运行时变量、D1 接口均以 Cloudflare Worker 为基础，改动最少。

Supabase 官方不把 Edge Functions 作为前端网页托管服务。若选择 Vercel，则需要把 Cloudflare Worker、D1 binding 和图片优化相关代码一并改写，迁移范围明显更大。

## 已准备内容

- `supabase/migrations/202609090001_wb_insight_core.sql`：当前四张 D1 表的 Postgres 等价结构。
- 商品详情继续使用 `(store_id, seller_sku)` 复合主键，一号店与二号店不会串数据。
- 所有表启用 RLS，未开放 `anon` 或 `authenticated` 浏览器访问策略。
- WB API token 与 Supabase service-role key 只允许保存在服务端环境变量中。

## 安全迁移顺序

1. 在用户自己的 Supabase 组织中新建项目，选择靠近主要访问者的区域。
2. 执行迁移 SQL，创建空表；此时不影响当前线上 D1。
3. 从 D1 导出四张表，并在测试环境导入 Supabase。
4. 对每张表核对行数、每店商品数、主键唯一性、金额字段合计和最新同步时间。
5. 增加统一的数据访问层；先对 D1 和 Supabase 双写，读取仍使用 D1。
6. 连续同步并比对至少一个完整自动同步周期，确认两边结果一致。
7. 将读取切到 Supabase；保留 D1 只读回退一段时间。
8. 在用户自己的 Cloudflare Workers（推荐）或 Vercel 部署网站，绑定自有域名。
9. 验证两个店铺的商品、订单、退货、财务、推广、评价、价格与手动同步功能后，再切换正式域名。

## 需要配置的服务端变量

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WB_API_TOKEN=
WB_API_TOKEN_CL=
SITE_URL=
```

`SUPABASE_SERVICE_ROLE_KEY` 和两个 WB token 禁止使用 `NEXT_PUBLIC_` 前缀，禁止写入 Git，禁止出现在浏览器网络请求或页面源码中。

## 上线前数据核对

- `product_costs`：按 `store_id` 分组的行数、seller SKU、nmId、成本和售价字段。
- `product_cost_deletions`：删除标记数量和对应店铺，避免已删除商品重新出现。
- `wb_sync_snapshots`：缓存键数量、最新 `updated_at`、payload 可解析性。
- `wb_sync_locks`：只迁移未过期锁，或上线时清空后由新环境重建。
- 随机抽查两家店至少 10 个商品和 10 笔订单，逐项对照当前线上页面。
- 切换前做完整 D1 导出并保留带时间戳的只读备份。

