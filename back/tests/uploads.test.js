// Upload endpoints (review finding F2): where a file may be written, what
// counts as an image, who may delete it, and that files are only served
// through signed, expiring links.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { JPEG, PNG, startTestApp } from "./helpers/testApp.js";

const HTML = Buffer.from("<html><script>alert(1)</script></html>");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const png = (field) => [field, PNG, "image/png", "picture.png"];

describe("uploads", () => {
  let ctx;
  let owner;
  let staff;

  // Every file under the working directory that is NOT inside public/uploads
  const filesOutsideUploads = () => {
    const uploadsRoot = path.join(ctx.workDir, "public", "uploads") + path.sep;
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (!full.startsWith(uploadsRoot)) found.push(full);
      }
    };
    walk(ctx.workDir);
    return found;
  };
  const onDisk = (storedPath) =>
    fs.existsSync(path.join(ctx.workDir, storedPath.replace(/^\//, "")));
  const upload = (url, token, form) => ctx.api("POST", url, { token, form });
  const remove = async (token, filePath) =>
    (await ctx.api("DELETE", "/upload/file", { token, body: { path: filePath } })).status;

  before(async () => {
    ctx = await startTestApp();
    owner = await ctx.owner();
    staff = await ctx.createStaff("Sam");
  });

  after(() => ctx?.stop());

  describe("folders", () => {
    it("files an avatar under the caller's account, under a random name", async () => {
      const response = await upload("/upload/avatar", owner.token, [png("avatar")]);
      assert.equal(response.status, 200);
      assert.ok(response.data.path.startsWith(`/public/uploads/admin/avatars/${owner.accountId}/`));
      assert.match(path.basename(response.data.path), /^[0-9a-f]{64}\.png$/);
    });

    it("files a general image in the shared images folder", async () => {
      const response = await upload("/upload/image", staff.token, [png("file")]);
      assert.equal(response.status, 200);
      assert.equal(path.posix.dirname(response.data.path), "/public/uploads/admin/images");
      assert.deepEqual(filesOutsideUploads(), []);
    });

    it("has no company-logo upload", async () => {
      assert.equal((await upload("/upload/logo", owner.token, [png("logo")])).status, 404);
    });
  });

  describe("file content", () => {
    it("rejects a file whose content is not what it claims, and removes it", async () => {
      const response = await upload("/upload/avatar", staff.token, [
        ["avatar", HTML, "image/png", "evil.png"],
      ]);
      assert.equal(response.status, 400);
      const folder = path.join(ctx.workDir, "public/uploads/admin/avatars", staff.accountId);
      assert.deepEqual(fs.existsSync(folder) ? fs.readdirSync(folder) : [], []);
    });

    it("rejects SVG", async () => {
      const response = await upload("/upload/image", owner.token, [
        ["file", SVG, "image/svg+xml", "evil.svg"],
      ]);
      assert.equal(response.status, 400);
    });

    it("accepts real images", async () => {
      assert.equal((await upload("/upload/image", owner.token, [png("file")])).status, 200);
      const jpeg = await upload("/upload/image", owner.token, [
        ["file", JPEG, "image/jpeg", "photo.jpg"],
      ]);
      assert.equal(jpeg.status, 200);
    });
  });

  describe("delete", () => {
    let image;
    let ownerAvatar;

    before(async () => {
      image = (await upload("/upload/image", owner.token, [png("file")])).data.path;
      ownerAvatar = (await upload("/upload/avatar", owner.token, [png("avatar")])).data.path;
    });

    it("reports someone else's avatar as missing, and leaves it on disk", async () => {
      assert.equal(await remove(staff.token, ownerAvatar), 404);
      assert.ok(onDisk(ownerAvatar));
    });

    it("rejects a path that leaves the upload folder, or names a folder", async () => {
      assert.equal(await remove(owner.token, "public/uploads/../../secret.txt"), 400);
      assert.equal(await remove(owner.token, path.posix.dirname(image)), 404);
    });

    it("lets a user delete their own avatar and shared images, given the signed link", async () => {
      const signedLink = (await upload("/upload/image", staff.token, [png("file")])).data.url;
      assert.equal(await remove(staff.token, `http://localhost:3000${signedLink}`), 200);
      assert.equal(await remove(staff.token, image), 200, "a shared image");
      assert.equal(await remove(owner.token, ownerAvatar), 200);
      assert.ok(!onDisk(image) && !onDisk(ownerAvatar));
    });
  });

  describe("signed links", () => {
    let first;
    let second;
    const query = (link) => link.slice(link.indexOf("?"));

    before(async () => {
      first = (await upload("/upload/image", owner.token, [png("file")])).data;
      second = (await upload("/upload/image", owner.token, [png("file")])).data;
    });

    it("refuses a bare path", async () => {
      assert.equal((await ctx.get(first.path)).status, 403);
    });

    it("serves the file through its signed link, cached privately", async () => {
      assert.match(first.url, /\?expires=\d+&signature=[0-9a-f]{64}$/);
      const response = await ctx.get(first.url);
      assert.equal(response.status, 200);
      assert.equal((await response.arrayBuffer()).byteLength, PNG.length);
      assert.match(response.headers.get("cache-control"), /^private, max-age=\d+$/);
    });

    it("refuses an altered signature, a later expiry, or another file's signature", async () => {
      const lastChar = first.url.endsWith("0") ? "1" : "0";
      assert.equal((await ctx.get(first.url.slice(0, -1) + lastChar)).status, 403);
      const later = first.url.replace(
        /expires=(\d+)/,
        (_, expires) => `expires=${Number(expires) + 3600}`
      );
      assert.equal((await ctx.get(later)).status, 403);
      assert.equal((await ctx.get(second.path + query(first.url))).status, 403);
    });

    it("refuses an expired link", async () => {
      const { signUploadUrl } = await ctx.importFromBack("server/src/utils/file/signedUrl.js");
      const realNow = Date.now;
      Date.now = () => realNow() - 3 * 60 * 60 * 1000; // sign as if it were three hours ago
      const expired = signUploadUrl(first.path);
      Date.now = realNow;
      assert.equal((await ctx.get(expired)).status, 403);
    });

    it("does not serve uploads under an encoded folder name", async () => {
      const response = await ctx.get(first.path.replace("/public/uploads/", "/public/%75ploads/"));
      assert.notEqual(response.status, 200);
    });

    it("refuses a profile image that is someone else's avatar", async () => {
      const ownersAvatar = (await upload("/upload/avatar", owner.token, [png("avatar")])).data;
      const theft = await ctx.api("PUT", "/admin/auth/me", {
        token: staff.token,
        body: { firstName: "Sam", lastName: "Staff", imageUrl: ownersAvatar.path },
      });
      assert.equal(theft.status, 400);
    });

    it("saves a profile image sent as its signed link as the plain path, and returns a working link", async () => {
      const own = (await upload("/upload/avatar", staff.token, [png("avatar")])).data;
      const saved = await ctx.api("PUT", "/admin/auth/me", {
        token: staff.token,
        body: { firstName: "Sam", lastName: "Staff", imageUrl: `http://localhost:3000${own.url}` },
      });
      assert.equal(saved.status, 200);
      assert.equal((await ctx.get(saved.data.user.imageUrl)).status, 200);

      const [[row]] = await ctx.sql.query(`SELECT imageUrl FROM users WHERE accountId = ?`, [
        staff.accountId,
      ]);
      assert.equal(row.imageUrl, own.path);
    });
  });
});
