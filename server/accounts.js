import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  chownSync,
} from "node:fs";
import path from "node:path";
import { prepareAvatar, saveAvatar } from "./avatars.js";

const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummySalt = randomBytes(16);
const digest = (token) => createHash("sha256").update(token).digest("hex");
let hashing = 0;
const hashWaiters = [];

export class AccountError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function username(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_]{3,24}$/.test(value.trim()))
    throw new AccountError("账号需为 3 至 24 位字母、数字或下划线");
  return value.trim().toLowerCase();
}

function nickname(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 16 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new AccountError("昵称需要 1 至 16 个字");
  return value.trim();
}

function password(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128)
    throw new AccountError("密码需要 8 至 128 个字符");
  return value;
}

async function key(value, salt) {
  if (hashing >= 4) {
    if (hashWaiters.length >= 12)
      throw new AccountError("操作较多，请稍后再试", 429);
    await new Promise((resolve) => hashWaiters.push(resolve));
  } else hashing++;
  try {
    return await derive(value, salt, 64, parameters);
  } finally {
    if (hashWaiters.length) hashWaiters.shift()();
    else hashing--;
  }
}

async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await key(password(value), salt)).toString("hex")}`;
}

async function verify(value, encoded) {
  if (typeof value !== "string" || value.length > 128) return false;
  if (!encoded) {
    await key(value, dummySalt);
    return false;
  }
  const [algorithm, salt, hash] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !/^[0-9a-f]{32}$/.test(salt) ||
    !/^[0-9a-f]{128}$/.test(hash)
  )
    return false;
  return timingSafeEqual(await key(value, salt), Buffer.from(hash, "hex"));
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatar || null,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export class AccountStore {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "accounts.json");
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, "utf8"))
      : { version: 1, users: [], invites: [], sessions: [], audit: [] };
    if (
      this.state.version !== 1 ||
      !["users", "invites", "sessions", "audit"].every((name) =>
        Array.isArray(this.state[name]),
      )
    )
      throw Error("Unsupported account data format");
  }

  commit(change) {
    const next = structuredClone(this.state);
    next.sessions = next.sessions.filter((s) => s.expiresAt > Date.now());
    const result = change(next);
    next.audit = next.audit.slice(-500);
    writeFileSync(this.file + ".tmp", JSON.stringify(next), { mode: 0o600 });
    if (process.getuid?.() === 0) {
      const owner = statSync(
        existsSync(this.file) ? this.file : path.dirname(this.file),
      );
      chownSync(this.file + ".tmp", owner.uid, owner.gid);
    }
    renameSync(this.file + ".tmp", this.file);
    this.state = next;
    return result;
  }

  audit(state, actor, action, target, details = {}) {
    state.audit.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      target,
      details,
    });
  }

  requireAdmin(state, actor) {
    const user = state.users.find(
      (u) => u.id === actor && u.role === "admin" && !u.disabled,
    );
    if (!user) throw new AccountError("没有管理权限", 403);
    return user;
  }

  getUser(id) {
    const user = this.state.users.find((u) => u.id === id);
    return user ? publicUser(user) : null;
  }

  usableInvite(state, code) {
    const normalized =
      typeof code === "string"
        ? code.trim().replace(/[-\s]/g, "").toUpperCase()
        : "";
    const invite = state.invites.find((i) => i.code === normalized);
    if (
      !invite ||
      !invite.active ||
      invite.used >= invite.maxUses ||
      (invite.expiresAt && invite.expiresAt <= Date.now())
    )
      throw new AccountError("邀请码无效、已过期或已用完", 403);
    return invite;
  }

  async register(input) {
    const account = username(input.username);
    const name = nickname(input.nickname);
    this.usableInvite(this.state, input.inviteCode);
    const avatar = await prepareAvatar(input.avatar);
    if (this.state.users.some((u) => u.username === account))
      throw new AccountError("账号已存在", 409);
    const passwordHash = await hashPassword(input.password);
    const user = this.commit((state) => {
      // Recheck after password hashing: concurrent registrations must not exceed the quota.
      const invite = this.usableInvite(state, input.inviteCode);
      if (state.users.some((u) => u.username === account))
        throw new AccountError("账号已存在", 409);
      if (state.users.length >= 200)
        throw new AccountError("账号数量已达上限", 409);
      const created = {
        id: randomUUID(),
        username: account,
        nickname: name,
        avatar: saveAvatar(path.dirname(this.file), avatar) || null,
        passwordHash,
        role: "user",
        disabled: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      state.users.push(created);
      invite.used++;
      this.audit(state, created.id, "register", created.id, {
        invite: invite.id,
      });
      return created;
    });
    return this.startSession(user.id);
  }

  async login(input) {
    let account;
    try {
      account = username(input.username);
    } catch {
      account = "";
    }
    const user = this.state.users.find((u) => u.username === account);
    const hash = user?.passwordHash;
    if (!(await verify(input.password, hash)) || !user || user.disabled)
      throw new AccountError("账号或密码错误", 401);
    const current = this.state.users.find((u) => u.id === user.id);
    if (!current || current.disabled || current.passwordHash !== hash)
      throw new AccountError("账号或密码错误", 401);
    return this.startSession(current.id);
  }

  startSession(userId) {
    const token = randomBytes(32).toString("hex");
    return this.commit((state) => {
      const user = state.users.find((u) => u.id === userId && !u.disabled);
      if (!user) throw new AccountError("请重新登录", 401);
      const expiresAt =
        Date.now() + (user.role === "admin" ? 12 * 3600000 : 30 * 86400000);
      const previous = state.sessions
        .filter((s) => s.userId === user.id)
        .slice(-9);
      state.sessions = [
        ...state.sessions.filter((s) => s.userId !== user.id),
        ...previous,
        { hash: digest(token), userId: user.id, expiresAt },
      ];
      user.lastLoginAt = new Date().toISOString();
      return { token, expiresAt, user: publicUser(user) };
    });
  }

  findSession(token) {
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
    const session = this.state.sessions.find(
      (s) => s.hash === digest(token) && s.expiresAt > Date.now(),
    );
    const user =
      session &&
      this.state.users.find((u) => u.id === session.userId && !u.disabled);
    return user
      ? { user: publicUser(user), expiresAt: session.expiresAt }
      : null;
  }

  revoke(token) {
    if (!this.findSession(token)) return;
    this.commit((state) => {
      state.sessions = state.sessions.filter((s) => s.hash !== digest(token));
    });
  }

  async bootstrapAdmin(input) {
    if (this.state.users.some((u) => u.role === "admin"))
      throw new AccountError("管理员已存在", 409);
    const account = username(input.username);
    const name = nickname(input.nickname);
    const passwordHash = await hashPassword(input.password);
    return this.commit((state) => {
      if (state.users.some((u) => u.role === "admin" || u.username === account))
        throw new AccountError("管理员或账号已存在", 409);
      const user = {
        id: randomUUID(),
        username: account,
        nickname: name,
        passwordHash,
        role: "admin",
        disabled: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      state.users.push(user);
      this.audit(state, user.id, "bootstrap_admin", user.id);
      return publicUser(user);
    });
  }

  createInvite(actor, input = {}) {
    const maxUses = input.maxUses ?? 1;
    const days = input.days ?? 30;
    if (
      !Number.isSafeInteger(maxUses) ||
      maxUses < 1 ||
      maxUses > 50 ||
      !Number.isSafeInteger(days) ||
      days < 0 ||
      days > 365
    )
      throw new AccountError("使用次数需为 1 至 50，有效天数需为 0 至 365");
    return this.commit((state) => {
      this.requireAdmin(state, actor);
      const invite = {
        id: randomUUID(),
        code: randomBytes(9).toString("hex").toUpperCase(),
        maxUses,
        used: 0,
        active: true,
        expiresAt: days ? Date.now() + days * 86400000 : null,
        createdAt: new Date().toISOString(),
        createdBy: actor,
      };
      state.invites.push(invite);
      this.audit(state, actor, "create_invite", invite.id, { maxUses, days });
      return { ...invite };
    });
  }

  updateInvite(actor, id, active) {
    if (typeof active !== "boolean")
      throw new AccountError("请输入有效的邀请码状态");
    return this.commit((state) => {
      this.requireAdmin(state, actor);
      const invite = state.invites.find((i) => i.id === id);
      if (!invite) throw new AccountError("邀请码不存在", 404);
      invite.active = active;
      this.audit(state, actor, "update_invite", id, { active });
      return { ...invite };
    });
  }

  async updateUser(actor, id, input) {
    this.requireAdmin(this.state, actor);
    const name =
      input.nickname === undefined ? undefined : nickname(input.nickname);
    const account =
      input.username === undefined ? undefined : username(input.username);
    if (input.disabled !== undefined && typeof input.disabled !== "boolean")
      throw new AccountError("请输入有效的账号状态");
    const passwordHash = input.password
      ? await hashPassword(input.password)
      : undefined;
    return this.commit((state) => {
      this.requireAdmin(state, actor);
      const user = state.users.find((u) => u.id === id);
      if (!user) throw new AccountError("账号不存在", 404);
      if (user.role === "admin" && input.disabled)
        throw new AccountError("不能停用管理员账号");
      if (
        account &&
        state.users.some((u) => u.id !== id && u.username === account)
      )
        throw new AccountError("账号已存在", 409);
      const revoked = Boolean(
        passwordHash ||
          (account && account !== user.username) ||
          (input.disabled !== undefined && input.disabled !== user.disabled),
      );
      if (name !== undefined) user.nickname = name;
      if (account !== undefined) user.username = account;
      if (input.disabled !== undefined) user.disabled = input.disabled;
      if (passwordHash) user.passwordHash = passwordHash;
      if (revoked)
        state.sessions = state.sessions.filter((s) => s.userId !== id);
      this.audit(state, actor, "update_user", id, {
        nickname: user.nickname,
        username: user.username,
        disabled: user.disabled,
        passwordReset: Boolean(passwordHash),
      });
      return { user: publicUser(user), revoked };
    });
  }

  record(actor, action, target, details) {
    this.commit((state) => {
      this.requireAdmin(state, actor);
      this.audit(state, actor, action, target, details);
    });
  }

  async updateSelf(token, input) {
    const session = this.findSession(token);
    if (!session) throw new AccountError("请重新登录", 401);
    if (
      Object.keys(input).some(
        (key) =>
          ![
            "nickname",
            "username",
            "currentPassword",
            "newPassword",
            "avatar",
          ].includes(key),
      )
    )
      throw new AccountError("只能修改自己的头像、昵称、账号和密码");
    const id = session.user.id;
    const original = this.state.users.find((user) => user.id === id);
    const observedHash = original.passwordHash;
    const name =
      input.nickname === undefined ? undefined : nickname(input.nickname);
    const account =
      input.username === undefined ? undefined : username(input.username);
    const avatar = await prepareAvatar(input.avatar);
    const changingPassword =
      input.newPassword !== undefined && input.newPassword !== "";
    const sensitive =
      changingPassword ||
      (account !== undefined && account !== original.username);
    if (sensitive && !(await verify(input.currentPassword, observedHash)))
      throw new AccountError("当前密码不正确", 403);
    const passwordHash = changingPassword
      ? await hashPassword(input.newPassword)
      : undefined;
    return this.commit((state) => {
      const user = state.users.find((u) => u.id === id && !u.disabled);
      if (
        !this.findSession(token) ||
        !user ||
        user.passwordHash !== observedHash
      )
        throw new AccountError("登录状态已变化，请重新登录", 401);
      if (
        account !== undefined &&
        state.users.some((u) => u.id !== id && u.username === account)
      )
        throw new AccountError("账号已存在", 409);
      const revoked =
        !!passwordHash || (account !== undefined && account !== user.username);
      if (name !== undefined) user.nickname = name;
      if (account !== undefined) user.username = account;
      if (avatar !== undefined)
        user.avatar = saveAvatar(path.dirname(this.file), avatar);
      if (passwordHash) user.passwordHash = passwordHash;
      if (revoked)
        state.sessions = state.sessions.filter((s) => s.userId !== id);
      this.audit(state, id, "update_self", id, {
        nickname: user.nickname,
        username: user.username,
        passwordChanged: !!passwordHash,
        avatarChanged: avatar !== undefined,
      });
      return { user: publicUser(user), revoked };
    });
  }

  recordAccount(actor, action, target, details) {
    this.commit((state) => {
      if (!state.users.some((u) => u.id === actor && !u.disabled))
        throw new AccountError("账号不存在或已停用", 403);
      this.audit(state, actor, action, target, details);
    });
  }

  adminState(actor) {
    this.requireAdmin(this.state, actor);
    return {
      users: this.state.users.map(publicUser),
      invites: structuredClone(this.state.invites).reverse(),
      audit: structuredClone(this.state.audit).reverse().slice(0, 100),
    };
  }
}
