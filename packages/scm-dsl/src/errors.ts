export interface DslError {
  message: string;
  line?: number;
  kind: 'syntax' | 'validation';
}
