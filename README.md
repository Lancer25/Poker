# Poker · 好友德州

[![Tests](https://github.com/Lancer25/Poker/actions/workflows/ci.yml/badge.svg)](https://github.com/Lancer25/Poker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

面向好友的实时德州扑克，包含网页客户端、原生微信小程序和 Node.js
服务端。支持最多 9 人同桌，使用虚拟筹码，不包含现金、支付或兑付功能。

## 功能

- 无限注德州扑克：跟注、加注、全下、边池、自动超时弃牌。
- 好友淘汰局、标准赛和快速赛；可配置行动时间、升盲间隔和初始筹码。
- 开局掷骰排座，手间自动续局，原房再开一场。
- 邀请码注册、个人资料、头像、管理员后台和测试机器人。
- 全员审批补筹码、手间暂停、准备和暂离。
- 观战审批；好友局淘汰玩家可主动开启上帝模式。
- 公共历史、已公开赢家底牌、新对局逐步回放和牌型概率提示。
- 三种主题、响应式牌桌、筹码动效、音效和可选震动。
- 断线恢复、操作去重、延迟诊断、备份与独立恢复校验。
- JSON 持久化，可选 SQLite/WAL。

## 快速开始

需要 **Node.js 24+**、npm 和 Git。当前为单进程服务，不需要 Redis 或外部数据库。

```sh
git clone https://github.com/Lancer25/Poker.git
cd Poker
npm ci
node server/manage-accounts.js bootstrap ./output/setup-local.json
npm start
```

打开 [http://localhost:3000](http://localhost:3000)。初始化命令会随机生成
管理员密码和首个邀请码，写入本机 `output/setup-local.json`，不会打印密码。
使用其中的账号登录；管理后台为 `/admin`。初始化只需执行一次，请妥善
保存该私密文件，不要上传。新玩家用邀请码注册后即可加入房间。

默认监听所有网络接口。仅本机开发时，复制 `.env.example` 为 `.env`，使用：

```sh
node --env-file=.env server/index.js
```

> 不要直接把本地 HTTP 调试服务暴露到公网。对外部署请使用 HTTPS/WSS，
> 并阅读[部署与存储](docs/guide/deployment.md)。

## 好友局默认规则

初始筹码 10000，盲注 10/20，行动时间 30 秒。房主发起掷骰排座，之后每手
结算 5 秒自动续手。默认每 3 分钟按平缓阶梯升盲，新盲注下一手生效，
每手最多升一级；前 20 分钟小盲上限为初始筹码的 1/20，最终上限为 1/10，
大盲为小盲两倍。升盲间隔可配置为 1–30 分钟。

新房最小筹码单位为 5。补筹码需申请时仍未淘汰的其他牌手全员同意，房主
不能代替他人批准。淘汰且筹码为零、不在当前手中的牌手可选择上帝模式；
补筹码审批通过后立即退出，下一手复活。仍在本手全下的玩家不能开启。

新观众默认需要房主审批，只看公开牌；房主可单独允许实时底牌。
普通在局牌手始终不能因此看到对手底牌。历史和回放只保留已公开牌面，
不会重建隐藏牌。牌型概率不等于获胜概率，也不会替玩家做决策。

## 微信小程序

使用微信开发者工具导入根目录，源码位于 `miniprogram/`。公开配置使用
`touristappid` 和本机调试地址，不含在用 AppID 或线上域名。
按[小程序配置](docs/guide/miniprogram.md)填写自己的 AppID 和服务地址。
本机地址不能直接用于真机或正式发布。

## 测试

```sh
npm test
```

包含规则、权限、存储、真实 WebSocket 多人对局、重连、行动超时、
观战隔离、补筹码和备份恢复测试。使用临时虚构账号，不连接线上服务器。
完整测试通常需要数分钟，部分测试会等待真实计时。GitHub Actions 会在
推送和 PR 时运行测试。

## 目录

```text
server/          服务端、规则、账号、存储和管理工具
public/          网页客户端、主题和游戏资源
miniprogram/     原生微信小程序与共享客户端逻辑
tests/           自动化测试和临时测试辅助代码
artwork/         可用的补充原始贴图
docs/guide/      使用、部署、存储和小程序说明
.github/         自动测试、依赖更新和协作模板
```

仓库不包含真实服务器配置、账号/房间数据、用户头像、数据库、备份、密钥、
开发记录或内部运维文档。服务端源码和通用管理工具是项目代码的一部分，
予以保留；它们不含部署凭据。

## 参与与许可

欢迎提交 Issue 和 PR，参见 [CONTRIBUTING.md](CONTRIBUTING.md)。
安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

项目按 [MIT](LICENSE) 开源。第三方依赖和图标遵守各自许可，详见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。项目用于学习和好友虚拟
筹码娱乐，部署者需自行确认所在地法律和平台要求。
