import { AccountError } from "./accounts.js";
import {transportInfo,requireSecureTransport} from './transport-security.js';

export function requestToken(req) {
  const bearer = req.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/);
  if (bearer) return bearer[1];
  return req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("holdem-auth="))
    ?.slice(12);
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

function origin(req) {
  const protocol = transportInfo(req).secure ? 'https' : 'http';
  return `${protocol}://${req.headers.host}`;
}

export function validCookieOrigin(req) {
  return !req.headers.origin || req.headers.origin === origin(req);
}

function cookie(req, token, seconds) {
  return `holdem-auth=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${origin(req).startsWith("https:") ? "; Secure" : ""}`;
}

async function body(req, maxSize = 8192) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new AccountError("请求格式不正确", 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) throw new AccountError("请求内容过长", 413);
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw Error();
    return result;
  } catch {
    throw new AccountError("请求格式不正确");
  }
}

export function createAccountApi(accounts, hooks) {
  const attempts = new Map();
  function throttle(req) {
    const address = req.socket.remoteAddress?.replace(/^::ffff:/, "");
    const local = ["127.0.0.1", "::1"].includes(address);
    const ip = local
      ? req.headers["x-forwarded-for"]?.split(",").at(-1)?.trim() || address
      : address;
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
    if (recent.length >= 30)
      throw new AccountError("登录或注册尝试过多，请稍后再试", 429);
    recent.push(now);
    attempts.set(ip, recent);
    if (attempts.size > 2000) {
      for (const [key, times] of attempts)
        if (now - times.at(-1) > 15 * 60000) attempts.delete(key);
      if (attempts.size > 2000) attempts.delete(attempts.keys().next().value);
    }
  }

  return async (req, res, pathname) => {
    try {
      const enforced=process.env.REQUIRE_SECURE_AUTH==='1';
      if(req.method==='GET'&&pathname==='/api/security')return json(res,200,transportInfo(req,{enforced}));
      requireSecureTransport(req,enforced);
      if (req.method !== "GET" && !validCookieOrigin(req))
        throw new AccountError("请求来源不允许", 403);
      if (
        req.method === "POST" &&
        ["/api/auth/register", "/api/auth/login"].includes(pathname)
      ) {
        throttle(req);
        const input = await body(
          req,
          pathname.endsWith("register") ? 192 * 1024 : 8192,
        );
        const result = pathname.endsWith("register")
          ? await accounts.register(input)
          : await accounts.login(input);
        res.setHeader(
          "Set-Cookie",
          cookie(
            req,
            result.token,
            Math.floor((result.expiresAt - Date.now()) / 1000),
          ),
        );
        return json(res, 200, result);
      }
      const token = requestToken(req);
      const session = accounts.findSession(token);
      if (!session) throw new AccountError("请先登录", 401);
      const user = session.user;
      if (req.method === "GET" && pathname === "/api/auth/me")
        return json(res, 200, { user });
      if (req.method === "PATCH" && pathname === "/api/account/profile") {
        throttle(req);
        const result = await accounts.updateSelf(
          token,
          await body(req, 192 * 1024),
        );
        hooks.accountChanged(result.user, result.revoked);
        if (result.revoked) res.setHeader("Set-Cookie", cookie(req, "", 0));
        return json(res, 200, {
          user: result.user,
          reauthenticate: result.revoked,
        });
      }
      if (req.method === "POST" && pathname === "/api/auth/logout") {
        await body(req);
        accounts.revoke(token);
        hooks.expireSessions();
        res.setHeader("Set-Cookie", cookie(req, "", 0));
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && pathname === "/api/auth/claim") {
        const input = await body(req);
        if (!Array.isArray(input.tokens) || input.tokens.length > 100)
          throw new AccountError("旧身份数量超出限制");
        return json(res, 200, hooks.claimLegacy(user, input.tokens));
      }
      const playerHistory=pathname.match(/^\/api\/rooms\/([0-9]{6})\/history$/);
      const profile=pathname.match(/^\/api\/rooms\/([0-9]{6})\/players\/([a-zA-Z0-9-]{1,80})$/);
      if(req.method==='GET'&&profile)return json(res,200,hooks.playerProfile(user,profile[1],profile[2]));
      const forecast=pathname.match(/^\/api\/rooms\/([0-9]{6})\/forecast$/);
      if(req.method==='GET'&&forecast) {
        const query=new URL(req.url,'http://localhost').searchParams;
        const result=await hooks.handForecast(user,forecast[1],Object.fromEntries(query));
        if(res.destroyed)return;
        if(accounts.findSession(token)?.user.id!==user.id)throw new AccountError('请重新登录',401);
        return json(res,200,result);
      }
      if(req.method==='GET'&&playerHistory) {
        const query=new URL(req.url,'http://localhost').searchParams;
        return json(res,200,hooks.playerHistory(user,playerHistory[1],{
          round:query.get('round') ?? 'current',offset:Number(query.get('offset') ?? 0),limit:Number(query.get('limit') ?? 50),
        }));
      }
      if (!pathname.startsWith("/api/admin/") || user.role !== "admin")
        throw new AccountError("没有管理权限", 403);
      if(req.method==='GET'&&pathname==='/api/admin/diagnostics')return json(res,200,hooks.diagnostics(user,req));
      if(req.method==='GET'&&pathname==='/api/admin/backups')return json(res,200,await hooks.backups(user));
      if(req.method==='POST'&&pathname==='/api/admin/backups'){await body(req);return json(res,200,await hooks.createBackup(user));}
      if (req.method === "GET" && pathname === "/api/admin/state")
        return json(res, 200, {
          ...accounts.adminState(user.id),
          legacy: hooks.legacyPlayers(),
          rooms: hooks.roomOwners(),
        });
      const history = pathname.match(
        /^\/api\/admin\/rooms\/([0-9]{6})\/history$/,
      );
      if (req.method === "GET" && history)
        return json(res, 200, hooks.roomHistory(history[1]));
      if (req.method === "POST" && pathname === "/api/admin/invites")
        return json(res, 200, {
          invite: accounts.createInvite(user.id, await body(req)),
        });
      const invite = pathname.match(/^\/api\/admin\/invites\/([0-9a-f-]+)$/);
      if (req.method === "PATCH" && invite)
        return json(res, 200, {
          invite: accounts.updateInvite(
            user.id,
            invite[1],
            (await body(req)).active,
          ),
        });
      const member = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/);
      if (req.method === "PATCH" && member) {
        const result = await accounts.updateUser(
          user.id,
          member[1],
          await body(req),
        );
        hooks.accountChanged(result.user, result.revoked);
        return json(res, 200, { user: result.user });
      }
      if (req.method === "POST" && pathname === "/api/admin/bind") {
        const input = await body(req);
        const target = accounts.getUser(input.userId);
        if (!target || target.disabled)
          throw new AccountError("账号不存在或已停用", 404);
        const result = hooks.bindLegacy(target, input.room, input.player);
        accounts.record(
          user.id,
          result.hostRecovered ? "recover_host" : "bind_legacy",
          target.id,
          {
            room: input.room,
            player: input.player,
          },
        );
        return json(res, 200, result);
      }
      if (req.method === "POST" && pathname === "/api/admin/recover-host") {
        const input = await body(req);
        const target = accounts.getUser(input.userId);
        if (!target || target.disabled)
          throw new AccountError("账号不存在或已停用", 404);
        const result = hooks.recoverHost(target, input.room);
        accounts.record(user.id, "recover_host", target.id, {
          room: input.room,
        });
        return json(res, 200, result);
      }
      throw new AccountError("接口不存在", 404);
    } catch (error) {
      if (!error.status) console.error("Account API:", error.message);
      json(res, error.status || 500, {
        error: error.status ? error.message : "服务器暂时不可用",
      });
    }
  };
}
