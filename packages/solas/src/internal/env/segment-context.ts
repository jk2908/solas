import * as Context from '../../utils/context.js'

export const SegmentContext = Context.create<{ id: string }>('segment')
