import { env } from 'cloudflare:workers';
import { AppError } from './model';
import { createPictureService } from './picture-service';
export function pictures() {
  if(!env.DB || !env.PICTURES) throw new AppError('Picture uploads are not available yet. Please try again later.',503);
  return createPictureService(env.DB,env.PICTURES);
}
