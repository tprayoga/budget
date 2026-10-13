import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@indotek/shared';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Endpoint yang dikecualikan dari cek CSRF (login, webhook ber-API-key). */
export const SKIP_CSRF = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** Endpoint yang tetap boleh diakses walau user wajib ganti password. */
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const ROLES_KEY = 'roles';
/** Batasi endpoint ke role tertentu. Tanpa @Roles = semua user login. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Role yang boleh mengubah data master/budget. */
export const EDITOR_ROLES: Role[] = ['ADMIN', 'PM'];

/** Role yang boleh mengubah setting khusus project (interest/retensi). */
export const PROJECT_SETTING_ROLES: Role[] = ['ADMIN', 'DIREKTUR'];

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
