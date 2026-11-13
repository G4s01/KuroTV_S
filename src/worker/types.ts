/**
 * Application environment, bindings, and shared response types.
 */

export type AppBindings = Env & {
  SYNC_ADMIN_SECRET?: string;
};

export type AppVariables = {
  profileId?: string;
  deviceId?: string;
  deviceType?: string;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};

export interface HealthResponse {
  ok: boolean;
  initialized: boolean;
  version: string;
  error?: string;
}
