import { describe, it, expect } from "vitest";
import { looksLikeKeycloakJwt } from "../../../src/bundler/core/oauth/jwt-shape.js";

describe("looksLikeKeycloakJwt", () => {
  it("returns true for a structurally valid JWT (three base64url segments)", () => {
    // header.payload.signature, each segment plausible base64url content -
    // this is not a real signed token, only shape matters here.
    expect(looksLikeKeycloakJwt("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl")).toBe(true);
  });

  it("returns false for the bundler's own opaque hex bundle token format", () => {
    expect(looksLikeKeycloakJwt("a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4")).toBe(false);
  });

  it("returns false when there are fewer than three segments", () => {
    expect(looksLikeKeycloakJwt("onlyone")).toBe(false);
    expect(looksLikeKeycloakJwt("two.segments")).toBe(false);
  });

  it("returns false when there are more than three segments", () => {
    expect(looksLikeKeycloakJwt("a.b.c.d")).toBe(false);
  });

  it("returns false when any segment is empty", () => {
    expect(looksLikeKeycloakJwt("a..c")).toBe(false);
    expect(looksLikeKeycloakJwt(".b.c")).toBe(false);
    expect(looksLikeKeycloakJwt("a.b.")).toBe(false);
  });

  it("returns false when a segment contains characters outside the base64url charset", () => {
    expect(looksLikeKeycloakJwt("a b.c.d")).toBe(false);
    expect(looksLikeKeycloakJwt("a+b.c.d")).toBe(false);
  });

  it("returns false for the empty string", () => {
    expect(looksLikeKeycloakJwt("")).toBe(false);
  });
});
