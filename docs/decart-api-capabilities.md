# Decart 官方能力及 Key 查询记录

核对日期：2026-10-15（北京时间）。本记录不保存完整 Key、账户私人内容或请求凭据。

## 此次实际查询

| 官方接口 | 结果 | 结论 |
|---|---|---|
| `GET https://api.decart.ai/v1/realtime/quota` | HTTP 200；`limit: null, active: null, remaining: null` | Key 鉴权有效。按官方字段定义，该账户未配置并发上限；这不表示有无限积分，也不表示有足够余额。 |
| `GET https://api.decart.ai/v1/files?limit=1` | HTTP 200；空文件列表 | Key 有权查询文件列表；未读取私人文件内容。 |
| `POST https://api.decart.ai/v1/models/resolve` | HTTP 200 | 公共模型别名解析可用；此接口不需要 Key，不证明具体账户的模型权限或余额。 |

返回的别名解析：

```json
{
  "lucy-latest": "lucy-2.5",
  "lucy-vton-latest": "lucy-vton-3.6",
  "lucy-restyle-latest": "lucy-restyle-2",
  "lucy-image-latest": "lucy-image-2"
}
```

查询带本地来源的响应返回了对应的 `Access-Control-Allow-Origin`，配额和文件列表支持本次浏览器来源跨域访问。

此次没有创建生成任务、开启付费实时会话、上传图片、签发令牌或修改账户。查询接口通过不代表所有生成模型均已实际测试；公开文档没有提供一个可按 Key 枚举全部模型权益和剩余积分的接口。

## 官方提供的功能

| 能力 | 主要模型 / 接口 | 文档价格（USD） | 本产品 |
|---|---|---|---|
| 实时服装试穿 | Lucy VTON 3.6 / 3.5 | $0.02/s；极速 $0.04/s | 已接入最新别名 |
| 实时视频编辑、角色变身、物体和背景编辑 | Lucy 2.5；上一代 Lucy 2.1 | $0.02/s；2.5 极速 $0.04/s | 已接入 Lucy 2.5 |
| 实时画面风格重绘 | Lucy Restyle 2 | $0.01/s | 已接入 |
| 预录视频编辑、试穿 | Queue API，Lucy 2.5 / VTON 3.6 等 | $0.04/生成秒 | 本轮未新增离线处理流程 |
| 预录视频风格重绘 | Queue API，Lucy Restyle 2 | $0.01/生成秒 | 本轮未新增离线处理流程 |
| 图片编辑 | Lucy Image 2 | 480p $0.01/次；720p $0.02/次 | 本轮未新增付费图片编辑流程 |
| 任务状态和结果下载 | `/v1/jobs/{job_id}` 及 `/content` | 参见生成任务计价 | 官方能力 |
| 图片、视频文件上传与管理 | `/v1/files`、文件元数据及 MD5 查询 | 查阅官方说明 | 文件列表查询已验证 |
| 临时客户端令牌 | `/v1/client/tokens` | 查阅官方说明 | 按用户要求保持前端自填 Key |
| 实时并发配额 | `/v1/realtime/quota` | 查询接口 | 已接入 Key 验证 |
| 世界模型驾驶模拟 | Oasis 3 Preview，独立 Python gRPC SDK | $0.02/s | 与当前浏览器试穿 SDK 分开 |

以上为平台公开能力，按 Key 的具体生成可用性与账单仍以实际服务端响应为准。价格可能更新，产品未接入自动价格刷新。

## 积分余额结论

官方文档索引与当前 OpenAPI 共列出 19 条路径，包含模型处理、任务、文件、临时令牌、模型别名解析和实时配额；其中没有账户积分 / credits / balance 的查询接口。

因此，当前公开接口没有提供「仅凭这个 API Key 直接读取官方积分余额」的方法。应在官方控制台查看余额；产品只展示有明确标签的本机费用估算，不把 `quota.remaining` 当作积分余额，也不预设新号积分。

## 官方来源

- [模型总览](https://docs.platform.decart.ai/getting-started/models)
- [价格](https://docs.platform.decart.ai/getting-started/pricing)
- [并发配额字段定义](https://docs.platform.decart.ai/api-reference/get-realtime-quota)
- [模型别名解析](https://docs.platform.decart.ai/api-reference/resolve-model-aliases)
- [JavaScript 实时 SDK](https://docs.platform.decart.ai/sdks/javascript-realtime)
- [虚拟试穿及参考图建议](https://docs.platform.decart.ai/models/realtime/virtual-try-on)
- [完整 OpenAPI](https://docs.platform.decart.ai/openapi.json)
- [官方控制台](https://platform.decart.ai)
