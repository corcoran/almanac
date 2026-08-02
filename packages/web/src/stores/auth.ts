import { TokenSummarySchema, WhoamiResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type Whoami = z.infer<typeof WhoamiResponseSchema>;
type Token = z.infer<typeof TokenSummarySchema>;

// POST /v1/auth/tokens returns the row PLUS the cleartext token (shown once).
const CreateTokenResponseSchema = TokenSummarySchema.extend({ token: z.string() });

const TokenListResponseSchema = z.array(TokenSummarySchema);

/**
 * Auth store — owns whoami + the user's personal-access-token list.
 *
 * The cleartext `token` returned by POST is captured in `lastMintedToken` so
 * the Settings panel can reveal it once and then forget it. `dismissMintedToken`
 * clears that field; nothing else holds onto the cleartext, including the
 * server (only the hash is stored). See `routes/auth.ts` and the
 * `TokenSummarySchema` comment for the contract.
 */
export const useAuthStore = defineStore("auth", {
  state: () => ({
    me: null as Whoami | null,
    tokens: [] as Token[],
    lastMintedToken: null as string | null,
    status: "idle" as Status,
    error: null as ApiError | null,
  }),
  actions: {
    async loadWhoami(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        this.me = await client.get("/v1/auth/whoami", WhoamiResponseSchema);
        this.status = "ready";
      } catch (e) {
        if (isApiError(e)) {
          this.error = e;
          this.status = "error";
          return;
        }
        throw e;
      }
    },

    async loadTokens(client: ApiClient): Promise<void> {
      // Mirror loadWhoami's status machine so consumers (TokenList) can
      // distinguish "still fetching" from "fetched and genuinely empty" —
      // otherwise the empty-state hint flashes on every Settings mount.
      this.status = "loading";
      this.error = null;
      try {
        this.tokens = await client.get("/v1/auth/tokens", TokenListResponseSchema);
        this.status = "ready";
      } catch (e) {
        if (isApiError(e)) {
          this.error = e;
          this.status = "error";
          return;
        }
        throw e;
      }
    },

    async createToken(client: ApiClient, name: string): Promise<void> {
      try {
        const minted = await client.post("/v1/auth/tokens", { name }, CreateTokenResponseSchema);
        // The cleartext is only available right here — server never returns
        // it again. Stash before reloading the list (which strips it).
        this.lastMintedToken = minted.token;
        await this.loadTokens(client);
      } catch (e) {
        if (isApiError(e)) {
          this.error = e;
          return;
        }
        throw e;
      }
    },

    async revokeToken(client: ApiClient, id: number): Promise<void> {
      try {
        await client.delete(`/v1/auth/tokens/${id}`, z.undefined());
        await this.loadTokens(client);
      } catch (e) {
        if (isApiError(e)) {
          this.error = e;
          return;
        }
        throw e;
      }
    },

    dismissMintedToken(): void {
      this.lastMintedToken = null;
    },
  },
});
