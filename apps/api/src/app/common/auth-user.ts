import type { Role } from '@as/shared';
import type { Request } from 'express';

/** Angemeldete Person, wie sie Guards und Controller sehen. */
export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  sessionId: string;
}

export interface AppRequest extends Request {
  user?: AuthUser;
}
