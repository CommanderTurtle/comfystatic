// Small native starter catalog; a real /object_info snapshot replaces this entirely.
const node = (name: string, category: string, required: any, output: string[], optional?: any) => ({
  name, display_name: name, description: '', category, python_module: 'nodes',
  input: { required, ...(optional ? { optional } : {}) },
  input_order: { required: Object.keys(required), ...(optional ? { optional: Object.keys(optional) } : {}) },
  output, output_name: output, output_is_list: output.map(() => false), output_node: output.length === 0
})
const int = (value: number, min = 0, max = 16384, step = 1) => ['INT', { default: value, min, max, step }]
const float = (value: number, min = 0, max = 100) => ['FLOAT', { default: value, min, max, step: .01 }]
const text = (multiline = false) => ['STRING', { default: '', multiline }]
export const coreNodes = {
  CheckpointLoaderSimple: node('CheckpointLoaderSimple', 'loaders', { ckpt_name: [['model.safetensors']] }, ['MODEL', 'CLIP', 'VAE']),
  CLIPTextEncode: node('CLIPTextEncode', 'conditioning', { text: text(true), clip: ['CLIP'] }, ['CONDITIONING']),
  EmptyLatentImage: node('EmptyLatentImage', 'latent', { width: int(512, 16, 16384, 8), height: int(512, 16, 16384, 8), batch_size: int(1, 1, 4096) }, ['LATENT']),
  KSampler: node('KSampler', 'sampling', { model: ['MODEL'], seed: ['INT', { default: 0, min: 0, max: Number.MAX_SAFE_INTEGER, control_after_generate: true }],
    steps: int(20, 1, 10000), cfg: float(8), sampler_name: [['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc']],
    scheduler: [['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta']],
    positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'], denoise: float(1, 0, 1) }, ['LATENT']),
  VAEDecode: node('VAEDecode', 'latent', { samples: ['LATENT'], vae: ['VAE'] }, ['IMAGE']),
  VAEEncode: node('VAEEncode', 'latent', { pixels: ['IMAGE'], vae: ['VAE'] }, ['LATENT']),
  VAELoader: node('VAELoader', 'loaders', { vae_name: [['vae.safetensors']] }, ['VAE']),
  UNETLoader: node('UNETLoader', 'loaders', { unet_name: [['model.safetensors']], weight_dtype: [['default', 'fp8_e4m3fn', 'fp8_e5m2']] }, ['MODEL']),
  CLIPLoader: node('CLIPLoader', 'loaders', { clip_name: [['clip.safetensors']], type: [['stable_diffusion', 'stable_cascade', 'sd3', 'stable_audio', 'mochi', 'ltxv', 'pixart', 'cosmos', 'lumina2', 'wan', 'hidream', 'chroma']], device: [['default', 'cpu']] }, ['CLIP']),
  LoraLoader: node('LoraLoader', 'loaders', { model: ['MODEL'], clip: ['CLIP'], lora_name: [['lora.safetensors']], strength_model: float(1, -100), strength_clip: float(1, -100) }, ['MODEL', 'CLIP']),
  LoadImage: node('LoadImage', 'image', { image: [['image.png'], { image_upload: false }] }, ['IMAGE', 'MASK']),
  SaveImage: node('SaveImage', 'image', { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] }, []),
  PreviewImage: node('PreviewImage', 'image', { images: ['IMAGE'] }, []),
  ImageScale: node('ImageScale', 'image/upscaling', { image: ['IMAGE'], upscale_method: [['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos']], width: int(512), height: int(512), crop: [['disabled', 'center']] }, ['IMAGE']),
  ConditioningCombine: node('ConditioningCombine', 'conditioning', { conditioning_1: ['CONDITIONING'], conditioning_2: ['CONDITIONING'] }, ['CONDITIONING'])
}
