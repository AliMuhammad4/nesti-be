import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import User from "../models/User.js";
import {
  changePasswordService,
  forgotPasswordService,
  googleLoginService,
  googleSignupService,
  loginService,
  resetPasswordService,
} from "../services/auth/authService.js";

const JWT_SECRET = process.env.JWT_SECRET || "secret";

function createRestoreBag() {
  const restores = [];
  return {
    stub(target, key, value) {
      const original = target[key];
      target[key] = value;
      restores.push(() => {
        target[key] = original;
      });
    },
    restoreAll() {
      while (restores.length) {
        const restore = restores.pop();
        restore();
      }
    },
  };
}

function mockGoogleFetch({ email = "user@example.com", sub = "google-sub-1" } = {}) {
  const audience = String(process.env.GOOGLE_CLIENT_ID || "").split(",")[0].trim();
  return async () => ({
    ok: true,
    async json() {
      return {
        email,
        email_verified: true,
        sub,
        given_name: "Test",
        family_name: "User",
        aud: audience,
        azp: audience,
      };
    },
  });
}

test("loginService blocks password login for google-auth users", async () => {
  const bag = createRestoreBag();
  try {
    bag.stub(User, "findOne", async () => ({
      auth_provider: "google",
      is_verified: true,
      matchPassword: async () => true,
    }));

    const result = await loginService({
      email: "google-user@example.com",
      password: "irrelevant",
    });

    assert.equal(result.status, 400);
    assert.match(result.body.message, /google sign-in/i);
  } finally {
    bag.restoreAll();
  }
});

test("loginService still allows local users with valid password", async () => {
  const bag = createRestoreBag();
  try {
    bag.stub(User, "findOne", async () => ({
      _id: "user-local-1",
      auth_provider: "local",
      is_verified: true,
      matchPassword: async () => true,
    }));

    const result = await loginService({
      email: "local-user@example.com",
      password: "valid-password",
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.ok(result.body.token);
  } finally {
    bag.restoreAll();
  }
});

test("forgotPasswordService gives google-auth users the same generic answer and no code", async () => {
  const bag = createRestoreBag();
  try {
    let saved = false;
    bag.stub(User, "findOne", async () => ({
      auth_provider: "google",
      email: "google-user@example.com",
      save: async () => {
        saved = true;
      },
    }));

    const result = await forgotPasswordService({ email: "google-user@example.com" });
    const unknown = await (async () => {
      bag.stub(User, "findOne", async () => null);
      return forgotPasswordService({ email: "nobody@example.com" });
    })();

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, unknown.body);
    assert.doesNotMatch(result.body.message, /google/i);
    assert.equal(saved, false);
  } finally {
    bag.restoreAll();
  }
});

test("changePasswordService blocks google-auth users", async () => {
  const bag = createRestoreBag();
  try {
    bag.stub(User, "findById", async () => ({
      auth_provider: "google",
    }));

    const result = await changePasswordService({
      userId: "google-user-1",
      currentPassword: "old",
      newPassword: "new",
    });

    assert.equal(result.status, 400);
    assert.match(result.body.message, /google sign-in/i);
  } finally {
    bag.restoreAll();
  }
});

test("resetPasswordService blocks google-auth users", async () => {
  const bag = createRestoreBag();
  try {
    bag.stub(User, "findById", async () => ({
      auth_provider: "google",
    }));

    const resetToken = jwt.sign(
      { id: "google-user-1", purpose: "password_reset", tv: 0 },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    const result = await resetPasswordService({
      resetToken,
      newPassword: "New-strong-pass1",
    });

    assert.equal(result.status, 400);
    assert.match(result.body.message, /google sign-in/i);
  } finally {
    bag.restoreAll();
  }
});

test("googleSignupService routes existing local account to email login", async () => {
  const bag = createRestoreBag();
  const originalFetch = global.fetch;
  try {
    global.fetch = mockGoogleFetch({ email: "existing-local@example.com" });
    bag.stub(User, "findOne", async () => ({
      auth_provider: "local",
    }));

    const result = await googleSignupService({
      token: "token-value",
      token_type: "access_token",
      role: "lawyer",
      phone: "+14155552671",
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'EMAIL_ALREADY_REGISTERED');
    assert.match(result.body.message, /email and password/i);
  } finally {
    bag.restoreAll();
    global.fetch = originalFetch;
  }
});

test("googleSignupService routes existing google account to google login", async () => {
  const bag = createRestoreBag();
  const originalFetch = global.fetch;
  try {
    global.fetch = mockGoogleFetch({ email: "existing-google@example.com" });
    bag.stub(User, "findOne", async () => ({
      auth_provider: "google",
    }));

    const result = await googleSignupService({
      token: "token-value",
      token_type: "access_token",
      role: "agent",
      phone: "+14155552671",
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'GOOGLE_ACCOUNT_EXISTS');
    assert.match(result.body.message, /log in with google/i);
  } finally {
    bag.restoreAll();
    global.fetch = originalFetch;
  }
});

test("googleLoginService blocks local account with same email", async () => {
  const bag = createRestoreBag();
  const originalFetch = global.fetch;
  try {
    global.fetch = mockGoogleFetch({ email: "local-only@example.com" });
    bag.stub(User, "findOne", async () => ({
      auth_provider: "local",
    }));

    const result = await googleLoginService({
      token: "token-value",
      token_type: "access_token",
    });

    assert.equal(result.status, 400);
    assert.match(result.body.message, /email\/password login/i);
  } finally {
    bag.restoreAll();
    global.fetch = originalFetch;
  }
});
