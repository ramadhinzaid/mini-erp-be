import { ApiProperty } from '@nestjs/swagger';

/** Token pair returned by register / login / refresh. */
export class AuthTokensDto {
  @ApiProperty({ description: 'Short-lived JWT access token' })
  accessToken: string;

  @ApiProperty({ description: 'Long-lived JWT refresh token' })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;
}
