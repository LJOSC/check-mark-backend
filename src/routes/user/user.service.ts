import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import Logger from 'src/configs/logger';
import { IAddUserPayload, ILoginUserPayload } from './user.types';
import * as userDao from './user.dao';
import APIError from 'src/utils/APIError';
import { generateTokens } from 'src/utils/generateToken';
import Format from 'src/utils/format';
import { sendEmail } from 'src/services/mailing';
import env from 'src/configs/envVars';
import { UserDoc } from 'models/User';
import { decodeRefreshToken } from 'src/middlewares/verifyRefreshToken';
import { Response } from 'express';

const logger = new Logger('user.service.ts');

const SERVICES_NAMES = {
  addUser: 'addUser()',
  loginUser: 'loginUser()',
  verifyEmail: 'verifyEmail()',
  refreshAccessToken: 'refreshAccessToken()',
  logoutUser: 'logoutUser()',
  forgotPassword: 'forgotPassword()',
};

/**
 * Add new user in the users collection
 *
 * @param {props} props - User Data
 */
export const addUser = async (props: IAddUserPayload): Promise<any> => {
  logger.log(`[${SERVICES_NAMES.addUser}] is called`);

  const propsClone = Object.assign({}, props);

  /* Check user is already register with email or not */
  const userWithEmail = await userDao.checkUserEmailExist(props.email);

  if (userWithEmail) {
    throw new APIError({
      message: 'Account already exists with this email.',
      status: 400,
    });
  }

  const result = await userDao.saveUser(propsClone);
  const createdUser = result.toObject();
  delete createdUser.password;
  delete createdUser.verificationToken;

  sendEmail({
    recipients: [{ email: result.email }],
    params: {
      verification_url: `${env.BACKEND_URL}/api/user/verify/${result.verificationToken}?email=${result.email}`,
    },
    templateId: 1,
  });

  if (result) {
    return Format.success(createdUser, 'User created successfully');
  }
};

/**
 * login an user
 *
 * @param {props} props - user credentials
 */
export const loginUser = async (props: ILoginUserPayload, res: Response): Promise<any> => {
  logger.log(`[${SERVICES_NAMES.loginUser}] is called`);

  const propsClone = Object.assign({}, props);
  const user = await userDao.getUserByEmailInsecure(propsClone.email);

  if (!user) {
    return Format.notFound('User not found');
  }

  const isPasswordMatch = await user.comparePassword(propsClone.password);
  const isVerified = user.isVerified;

  if (!isVerified) {
    sendEmail({
      recipients: [{ email: user.email }],
      params: {
        verification_url: `${env.BACKEND_URL}/api/user/verify/${user.verificationToken}?email=${user.email}`,
      },
      templateId: 1,
    });
    return Format.error(403, 'Email not verified. Verification link sent to your email.');
  }

  if (!isPasswordMatch) {
    return Format.unAuthorized('Invalid credentials');
  }

  const { accessToken, refreshToken } = generateTokens({ id: user.id, email: user.email });

  user.lastLogin = new Date();

  await user.save();

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
  });

  const data = {
    accessToken,
  };

  if (user) {
    return Format.success(data, 'User login successful');
  }
};

/**
 * Verify email
 *
 * @param {token} token - verification token
 * @param {email} email - email
 */
export const verifyEmail = async (token: string, email: string): Promise<any> => {
  logger.log(`[${SERVICES_NAMES.verifyEmail}] is called`);

  const user = await userDao.getUserByEmailInsecure(email);

  if (!user) {
    return Format.notFound('User not found');
  }

  if (user.verificationToken === token) {
    user.isVerified = true;
    user.verificationToken = '';
    await user.save();
    return Format.success({}, 'Email verified successfully');
  }

  return Format.badRequest('Invalid verification link');
};

/**
 * Refresh Access Token
 *
 * @param {user} user - user
 * @param {token} oldToken - refresh token
 */
export const refreshAccessToken = async (user: UserDoc, oldToken: string, res: Response): Promise<any> => {
  logger.log(`[${SERVICES_NAMES.refreshAccessToken}] is called`);
  let expiryTimestamp = 0;

  const { exp } = await decodeRefreshToken(oldToken);
  expiryTimestamp = exp;
  await userDao.blacklistToken(oldToken, expiryTimestamp);

  const { accessToken, refreshToken } = generateTokens({ id: user.id, email: user.email });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
  });
  const data = { accessToken };
  return Format.success(data, 'Access,Refresh token updated successfully');
};

/**
 * Logout user
 *
 * @param {token} refreshToken - refresh token
 */
export const logoutUser = async (refreshToken: string): Promise<any> => {
  logger.log(`[${SERVICES_NAMES.logoutUser}] is called`);

  let expiryTimestamp = 0;
  try {
    const { exp } = await decodeRefreshToken(refreshToken);
    expiryTimestamp = exp;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('Expired token received!');
    } else {
      logger.warn('Invalid token received!');
    }
    return Format.success({}, 'User already logged out');
  }

  await userDao.blacklistToken(refreshToken, expiryTimestamp);

  return Format.success({}, 'User logged out successfully');
};

/**
 * Forgot password - get the OTP
 *
 * @param {email} email - email
 */
export const forgotPassword = async (email: string): Promise<any> => {
  logger.log(`[${SERVICES_NAMES.forgotPassword}] is called`);

  const user = await userDao.getUserByEmail(email);

  if (!user) {
    return Format.notFound('User not found');
  }

  const otp = crypto.randomBytes(6).toString('hex');
  const salt = await bcrypt.genSalt(10);
  const hashedOtp = await bcrypt.hash(otp, salt);

  user.otp = hashedOtp;
  user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);

  await sendEmail({
    recipients: [{ email: user.email }],
    params: {
      otp,
    },
    templateId: 2,
  });

  await user.save();

  return Format.success({}, 'OTP sent to your email');
};

/**
 * Reset Password - Update password
 *
 * @param {props} props - email, password and otp
 */
export const resetPassword = async (props: { email: string; password: string; otp: string }): Promise<any> => {
  logger.log(`[${SERVICES_NAMES.forgotPassword}] is called`);

  const user = await userDao.getUserByEmailInsecure(props.email);

  if (!user) {
    return Format.notFound('User not found');
  }

  if (!user.otpExpires || !user.otp || user.otpExpires < new Date()) {
    return Format.badRequest('OTP expired');
  }

  const isOtpMatch = bcrypt.compare(props.otp, user.otp);

  if (!isOtpMatch) {
    return Format.badRequest('Invalid OTP');
  }

  user.password = props.password;
  user.otp = undefined;
  user.otpExpires = undefined;

  await user.save();

  return Format.success({}, 'Password reset successfully');
};
