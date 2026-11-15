import { Role } from '../../auth/role.enum';
import { User } from '../user.entity';

/** What the API returns for a user: no passwordHash. */
export class UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  role: Role;

  static from(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.displayName = user.displayName;
    dto.role = user.role;
    return dto;
  }
}
