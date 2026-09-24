import nodemailer, { Transporter } from "nodemailer";
import { env } from "../../config/env.config";

let transporter: Transporter | null = null;

export const isMailConfigured = () => Boolean(env.MAIL.USER && env.MAIL.PASS);

const getTransporter = () => {
  transporter ??= nodemailer.createTransport({
    host: env.MAIL.HOST,
    port: env.MAIL.PORT,
    secure: env.MAIL.PORT === 465,
    auth: { user: env.MAIL.USER, pass: env.MAIL.PASS },
  });

  return transporter;
};

export const sendMail = async (mail: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) => {
  await getTransporter().sendMail({
    from: { name: env.MAIL.FROM_NAME, address: env.MAIL.USER },
    ...mail,
  });
};
