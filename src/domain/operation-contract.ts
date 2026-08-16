export interface OperationContract<Name extends string, Request, Result> {
  readonly name: Name;
  readonly version: 1;
  readonly validateRequest: (input: unknown) => Request;
  readonly validateResult: (input: unknown) => Result;
}
