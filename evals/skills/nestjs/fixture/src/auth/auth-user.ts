import { Role } from './role.enum';

/** What JwtAuthGuard puts on the request as `req.user`. */
export interface AuthUser {
  id: string;
  role: Role;
}
