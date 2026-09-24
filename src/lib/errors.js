/** 入参校验失败（HTTP 400） */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** 资源冲突，如目标路径已是 openspec 项目（HTTP 409） */
export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** 环境/外部命令失败，如 git、openspec CLI 异常（HTTP 500） */
export class EnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvError';
  }
}
