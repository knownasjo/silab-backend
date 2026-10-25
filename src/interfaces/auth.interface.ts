export interface IJWTUserPayload {
  id: string;
  nim: string;
  role: string;
  fullname: string;
}

export interface IUserLoginRequestBody {
  nim: string;
  password: string;
  deviceId?: string;
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
  expiresIn: number;
  resendIn: number;
}

export interface IVerifyRegistrationRequestBody {
  email: string;
  code: string;
}

export interface IResendRegistrationRequestBody {
  email: string;
}

export interface IUpdateProfileRequestBody {
  fullname: string;
}

export interface IUserProfileResponseBody {
  id: string;
  nim: string;
  name: string;
  email: string;
  role: string;
}

export interface IChangePasswordRequestBody {
  oldPassword: string;
  password: string;
  confirmPassword: string;
}

export interface IForgotPasswordRequestBody {
  email: string;
}

export interface IPasswordResetCodeResponseBody {
  email: string;
  expiresIn: number;
  resendIn: number;
}

export interface IResetPasswordRequestBody {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
}
