export interface IJWTUserPayload {
  id: string;
  nim: string;
  role: string;
  fullname: string;
}

export interface IUserLoginRequestBody {
  nim: string;
  password: string;
}

export interface IUserLoginResponseBody {
  accessToken: string;
  refreshToken: string;
}

export interface IRefreshTokenRequestBody {
  refreshToken: string;
}

export interface IRefreshTokenResponseBody {
  accessToken: string;
}

export interface IUserRegisterRequestBody {
  fullname: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface IRegistrationResponseBody {
  email: string;
  nim: string;
  expires_in: number;
  resend_in: number;
}

export interface IVerifyRegistrationRequestBody {
  email: string;
  code: string;
}

export interface IResendRegistrationRequestBody {
  email: string;
}

export interface IForgotPasswordRequestBody {
  email: string;
}

export interface IPasswordResetCodeResponseBody {
  email: string;
  expires_in: number;
  resend_in: number;
}

export interface IResetPasswordRequestBody {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
}
