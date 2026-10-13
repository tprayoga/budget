import type { Role } from '@indotek/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  /** must change password */
  mcp?: boolean;
}
