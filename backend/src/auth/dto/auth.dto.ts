import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;
const PASSWORD_MESSAGE = 'Use at least 10 characters with at least one letter and one number.';

export class RegisterDto {
  @ApiProperty({ example: 'asha@example.com' })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'correct-horse-42' })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiProperty({ example: 'Asha Verma' })
  @IsString()
  @MinLength(1, { message: 'Enter your name.' })
  @MaxLength(120)
  fullName: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail({}, { message: 'Enter a valid email address.' }) email: string;
  @ApiProperty() @IsString() @IsNotEmpty({ message: 'Enter your password.' }) @MaxLength(128) password: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token from Google Sign-In' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @IsNotEmpty() refreshToken: string;
}

export class EmailDto {
  @ApiProperty() @IsEmail({}, { message: 'Enter a valid email address.' }) email: string;
}

export class TokenDto {
  @ApiProperty() @IsString() @IsNotEmpty() token: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() token: string;
  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }) password: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Sign out of every device' })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}

export class AuthTokensResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty() accessTokenExpiresIn: number;
}
