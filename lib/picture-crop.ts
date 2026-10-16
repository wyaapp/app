export type PictureCrop = {zoom:number;x:number;y:number;rotation:number};
export const initialCrop:PictureCrop={zoom:1,x:0,y:0,rotation:0};
export function cropGeometry(width:number,height:number,crop:PictureCrop,size:number) {
  const sideways=crop.rotation%180!==0;
  const rotatedWidth=sideways ? height : width;
  const rotatedHeight=sideways ? width : height;
  const scale=Math.max(size/rotatedWidth,size/rotatedHeight)*crop.zoom;
  return {scale,overflowX:Math.max(0,(rotatedWidth*scale-size)/2),overflowY:Math.max(0,(rotatedHeight*scale-size)/2)};
}
export function drawPicture(canvas:HTMLCanvasElement,image:ImageBitmap,crop:PictureCrop) {
  const ctx=canvas.getContext('2d');
  if(!ctx) throw new Error('Your browser could not prepare this picture.');
  const size=canvas.width;
  const g=cropGeometry(image.width,image.height,crop,size);
  ctx.clearRect(0,0,size,size);
  ctx.save();
  ctx.translate(size/2+crop.x*g.overflowX,size/2+crop.y*g.overflowY);
  ctx.rotate(crop.rotation*Math.PI/180);
  ctx.scale(g.scale,g.scale);
  ctx.drawImage(image,-image.width/2,-image.height/2);
  ctx.restore();
}
