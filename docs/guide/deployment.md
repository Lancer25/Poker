# 部署与存储

本页为通用说明，不包含维护者的主机、域名、凭据或线上数据。

## 启动与配置

```sh
npm ci --omit=dev
node --env-file=.env server/index.js
```

`.env` 需自行创建，`npm start` 不会自动加载它。生产环境建议由进程管理器
注入环境变量。需要静态资源及 `miniprogram/utils/` 共享模块，不能只复制
`server/`。安装依赖时保留锁文件。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 反向代理后建议 `127.0.0.1` |
| `PORT` | `3000` | HTTP/WebSocket 端口 |
| `DATA_DIR` | 根目录下 `data/` | 私有持久存储 |
| `ROOM_STORAGE` | `json` | 可选 `sqlite`，不隐式迁移 JSON |
| `BACKUP_DIR` | 数据目录下 `backups/` | 私有备份目录 |
| `BACKUP_INTERVAL_MS` | `21600000` | 每 6 小时备份，`0` 禁用 |
| `BACKUP_KEEP` | `14` | 保留份数，范围 1–90 |
| `REQUIRE_SECURE_AUTH` | `0` | `1` 拒绝非安全 API/WS 连接 |
| `PUBLIC_HTTPS_URL` | 未设置 | 自己的 HTTPS 站点根地址 |

代理必须支持 WebSocket Upgrade，并传递请求协议。服务只信任回环代理的
协议转发头。远程代理或容器网络需要先验证信任边界，不要直接删除安全
检查。配置证书后验证登录、WS 重连、头像和静态资源，再启用强制安全认证。

只运行一个游戏进程，不要让多个实例同时写一个数据目录，也不要把数据
目录映射为静态目录。发布前备份、检查活动玩家，避免在手牌进行中重启。
更新后老客户端可能需要刷新以使用新操作协议。

## 管理员

```sh
node --env-file=.env server/manage-accounts.js bootstrap ./output/setup-local.json
node --env-file=.env server/manage-accounts.js reset-admin ./output/admin-reset.json
```

第二条用于重置已有管理员密码。输出文件必须使用新路径，妥善保管。
邀请码和普通账号可在 `/admin` 管理。不要提交真实密码、会话或数据文件。

## 备份与恢复

后台支持创建备份和检查完整性。备份在工作线程执行，包含房间、账号和
可用头像，并附 SHA-256 清单及独立恢复/加载校验。备份本身也是敏感数据，
还需自行保留异地或离线副本。

下面都是示例路径。CLI 备份和转换前应停止对应服务；`--offline` 是操作者
确认，不会自动检测或停止进程。

```sh
node server/storage-tools.js backup ./data ./private-backups --offline
node server/storage-tools.js list ./private-backups
node server/storage-tools.js verify ./private-backups/BACKUP_NAME
node server/storage-tools.js restore ./private-backups/BACKUP_NAME ./restored-data
```

恢复目标必须是不存在的新目录，父目录需存在。不要覆盖运行中的数据。
先用独立实例核对，再明确切换 `DATA_DIR`。

## 可选 SQLite

```sh
node server/storage-tools.js import-json ./data ./sqlite-data --offline
node server/storage-tools.js export-json ./sqlite-data ./exported-json --offline
```

转换保留账号、头像、房间和会话，验证内存及重新打开后的数据一致性。
输入目录不会被替换。切换时设置 `ROOM_STORAGE=sqlite` 及新 `DATA_DIR`。
SQLite 使用 WAL，运行时不能仅复制数据库主文件充当完整备份，请使用
提供的备份工具。JSON 仍为默认存储方式。
