import { BadRequestError } from "../HttpErrors/HttptErrors";

export const MIN_PASSWORD_LENGTH = 8;

export const hasWhitespace = (password: string) => /\s/.test(password);

export const assertNewPassword = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new BadRequestError(
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter!`
    );

  if (hasWhitespace(password))
    throw new BadRequestError("Password tidak boleh mengandung spasi!");
};
