import { OmitType } from '@nestjs/swagger';
import { CreateUserDto } from 'src/modules/users/dto/create-user.dto';

/**
 * Self-registration payload. `role` is intentionally omitted so users cannot
 * escalate their own privileges — every self-registered account is a USER.
 */
export class RegisterDto extends OmitType(CreateUserDto, ['role'] as const) {}
