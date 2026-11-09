# WB Insight / WB 店铺经营管理

多店铺 Wildberries 经营后台源码备份。当前运行于 Cloudflare Workers，使用 Supabase 保存产品资料、订单备注及同步快照，使用 Cloudflare KV 保存登录配置、登录设备记录和加密的店铺 API 设置。

## 主要功能

- 多店铺切换、店铺 API 管理及账号登录保护。
- 经营总览、销售订单、商品分析、产品详情及成本定价。
- 库存、退货物流、财务回款、推广、平台活动及评价分析。
- 订单备注气泡及已标记订单筛选。
- 分页面手动同步、定时同步、超时保护及历史数据回退。

## 本地开发与构建

需要 Node.js 22.13.0 或更新版本。

```bash
npm ci
npm run dev
npm run build
```

应用代码在 `app/`，Cloudflare 入口在 `worker/index.ts`。`vite.config.ts` 包含本地运行时绑定配置；生产绑定使用 `wrangler.cloudflare.jsonc`。

## 恢复到 Cloudflare

1. 在目标 Cloudflare 账户中配置 Workers、`AUTH_KV`、Images 及域名绑定，核对 `wrangler.cloudflare.jsonc` 中的资源 ID 和域名。
2. 在 Supabase 初始化数据库时执行 `supabase/migrations/` 中的迁移。已有生产数据库应先备份并核对，不能直接重建。
3. 通过 Cloudflare 服务端 Secrets 配置 `SUPABASE_SERVICE_ROLE_KEY`、`AUTH_SESSION_SECRET`，以及使用环境变量接入的 `WB_API_TOKEN`、`WB_API_TOKEN_CL`。`SUPABASE_URL` 位于生产配置中。
4. 恢复 Cloudflare KV 中的登录配置和店铺设置。已有加密店铺 API 需要配套的原 `AUTH_SESSION_SECRET` 才能解密；恢复到空 KV 时需要单独初始化登录配置并重新配置店铺。
5. 执行 `npm run deploy:cloudflare`，登录后逐店检查订单数量、商品成本、余额和同步结果。

`.env.example` 只含变量名称，不含凭据。不要提交 `.env.local`、`.dev.vars`、私钥、数据库导出或运行日志，也不要给服务端密钥添加 `NEXT_PUBLIC_` 前缀。

数据库结构和迁移背景见 [Supabase 迁移说明](docs/supabase-migration.md)。

## 代码备份与业务数据

此 Git 仓库保存源码、依赖锁文件、数据库结构、测试和部署配置，不包含线上 Supabase/KV 的业务数据及服务端 Secrets。完整灾备还需要单独保管 Supabase 数据备份、Cloudflare KV 备份及原加密密钥；这些文件不要上传本代码仓库。

生产配置中已有域名、数据库地址及 KV 资源 ID 只表示部署目标，不等于访问凭据。

## 检查

```bash
npm run build
node --experimental-strip-types --experimental-vm-modules --test tests/*.test.mjs
```

测试包括订单状态与利润、产品匹配、退货新版接口、备注读写隔离及同步超时处理。`tests/rendered-html.test.mjs` 使用已有构建产物，应先构建。

GitHub 备份仓库：<https://github.com/wangzhen10234-prog/wbguanliwangzhan>
