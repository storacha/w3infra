
export interface UcantoServerContext extends InvocationServiceContext {}

export interface InvocationServiceContext {

}

export interface Service {
  invocation: {
    add: ServiceMethod<StoreAdd, StoreAddResult, Failure>
  },
}
