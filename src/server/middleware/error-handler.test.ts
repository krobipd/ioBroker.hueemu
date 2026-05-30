/**
 * Tests for the Hue Fastify error handler. The route tests cover the
 * HueApiError + validation paths via inject(); this file covers the units
 * directly — especially the generic-error → INTERNAL_ERROR branch and the
 * createHueErrorHandler logging factory, which the route tests don't reach.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hueErrorHandler, createHueErrorHandler, createSuccessResponse } from "./error-handler";
import { HueApiError, HueErrorType } from "../../types/errors";
import type { Logger } from "../../types/config";

function mockReply(): { reply: FastifyReply; sent: { status?: number; body?: unknown } } {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
    },
  };
  return { reply: reply as unknown as FastifyReply, sent };
}

function req(url = "/api/test", method = "POST"): FastifyRequest {
  return { url, method } as unknown as FastifyRequest;
}

function firstError(body: unknown): { type: number; address: string; description: string } {
  return (body as Array<{ error: { type: number; address: string; description: string } }>)[0].error;
}

describe("hueErrorHandler", () => {
  it("returns a HueApiError verbatim (status 200, Hue array shape)", () => {
    const { reply, sent } = mockReply();
    hueErrorHandler(HueApiError.resourceNotAvailable("5", "/lights/5"), req("/lights/5"), reply);
    expect(sent.status).toBe(200);
    const err = firstError(sent.body);
    expect(err.type).toBe(HueErrorType.RESOURCE_NOT_AVAILABLE);
    expect(err.address).toBe("/lights/5");
  });

  it("wraps a generic Error as INTERNAL_ERROR (901) with the message + request url", () => {
    const { reply, sent } = mockReply();
    hueErrorHandler(new Error("boom"), req("/api/x"), reply);
    expect(sent.status).toBe(200);
    const err = firstError(sent.body);
    expect(err.type).toBe(HueErrorType.INTERNAL_ERROR);
    expect(err.address).toBe("/api/x");
    expect(err.description).toContain("boom");
  });

  it("maps a Fastify validation error to INVALID_JSON (2)", () => {
    const { reply, sent } = mockReply();
    const validationErr = Object.assign(new Error("bad body"), {
      validation: [{ keyword: "type" }],
    }) as unknown as FastifyError;
    hueErrorHandler(validationErr, req(), reply);
    expect(firstError(sent.body).type).toBe(HueErrorType.INVALID_JSON);
  });

  it("falls back to 'Unknown error' when the generic error has no message", () => {
    const { reply, sent } = mockReply();
    hueErrorHandler(new Error(""), req(), reply);
    expect(firstError(sent.body).description).toContain("Unknown error");
  });

  it("uses '/' as address when request.url is missing", () => {
    const { reply, sent } = mockReply();
    hueErrorHandler(new Error("x"), { method: "GET" } as unknown as FastifyRequest, reply);
    expect(firstError(sent.body).address).toBe("/");
  });
});

describe("createHueErrorHandler", () => {
  it("returns the plain handler when no logger is given", () => {
    expect(createHueErrorHandler()).toBe(hueErrorHandler);
    expect(createHueErrorHandler(undefined)).toBe(hueErrorHandler);
  });

  it("logs method/url/type and still sends the response when a logger is given", () => {
    const debug = vi.fn();
    const logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const handler = createHueErrorHandler(logger);
    const { reply, sent } = mockReply();

    handler(new Error("kaboom"), req("/api/y", "PUT"), reply);

    expect(debug).toHaveBeenCalledWith(expect.stringContaining("PUT /api/y"));
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("internal_error"));
    // delegates: response still produced
    expect(firstError(sent.body).type).toBe(HueErrorType.INTERNAL_ERROR);
  });

  it("logs the numeric type for a HueApiError", () => {
    const debug = vi.fn();
    const logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const handler = createHueErrorHandler(logger);
    const { reply } = mockReply();
    handler(HueApiError.unauthorizedUser("/api/z/lights"), req("/api/z/lights", "GET"), reply);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining(String(HueErrorType.UNAUTHORIZED_USER)));
  });
});

describe("createSuccessResponse", () => {
  it("wraps data in the Hue success array shape", () => {
    expect(createSuccessResponse({ username: "abc" })).toEqual([{ success: { username: "abc" } }]);
  });
});
