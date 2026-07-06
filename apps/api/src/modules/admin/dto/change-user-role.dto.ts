import { IsIn } from 'class-validator';
import { Role } from '@prisma/client';

// DTO-level guard: ADMIN is not a valid target role.
// Service-level guard also rejects requests targeting an existing ADMIN.
export class ChangeUserRoleDto {
  @IsIn([Role.USER, Role.MODERATOR, Role.EDITOR])
  role!: Role;
}
