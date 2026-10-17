import {z} from 'zod';

export const MAX_ITEM_BUTTONS=3;
export type ItemButton={label:string;url:string};
export type ItemButtonDraft={label:string;destination:string};
export const itemButtonSchema=z.object({label:z.string().trim().min(1).max(30),destination:z.string().trim().min(1).max(2048)}).strict();
