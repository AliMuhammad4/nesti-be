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
  return async () => ({
    ok: true,
    async json() {
      return {
        email,
        email_verified: true,
        sub,
        given_name: "Test",
        family_name: "User",
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

test("forgotPasswordService blocks google-auth users", async () => {
  const bag = createRestoreBag();
  try {
    bag.stub(User, "findOne", async () => ({
      auth_provider: "google",
      email: "google-user@example.com",
    }));

    const result = await forgotPasswordService({ email: "google-user@example.com" });

    assert.equal(result.status, 400);
    assert.match(result.body.message, /google/i);
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
      { id: "google-user-1", email: "google-user@example.com" },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    const result = await resetPasswordService({
      resetToken,
      newPassword: "new-strong-password",
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
    });

    assert.equal(result.status, 409);
    assert.match(result.body.message, /email\/password/i);
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
    });

    assert.equal(result.status, 409);
    assert.match(result.body.message, /google login/i);
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
