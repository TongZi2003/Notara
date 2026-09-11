import { createHash } from 'node:crypto';
import { CourseClosureSchema, CoursePatchSchema, type CourseClosure, type CourseMetadataData, type CourseMetadataSchema, type CourseView, type HostContext, type MutationContext } from '@studyforge/contracts';
import { RecordError, type RecordStore } from '../storage/record-store.ts';

/** Native id is the sole classroom identity. An untouched lesson needs no extra row. */
export class CourseMetadata {
  private readonly records: RecordStore<typeof CourseMetadataSchema>;
  constructor(records: RecordStore<typeof CourseMetadataSchema>) { this.records = records; }
  private session(ctx: HostContext): string {
    if (ctx.purpose !== 'learning' || !ctx.sessionId) throw new RecordError('learning_session_required');
    if (ctx.workspaceId !== this.records.workspaceId) throw new RecordError('workspace_mismatch');
    return ctx.sessionId;
  }
  private id(ctx: HostContext): string { return createHash('sha256').update(this.session(ctx)).digest('hex'); }
  read(ctx: HostContext): CourseView {
    const sessionId = this.session(ctx);
    try {
      const saved = this.records.read(ctx, 'course:' + this.id(ctx));
      if (saved.data.sessionId !== sessionId) throw new RecordError('course_binding_mismatch');
      return { version: saved.version, data: saved.data };
    } catch (error) {
      if (!(error instanceof RecordError) || error.code !== 'record_missing') throw error;
      return { version: 0, data: { sessionId, lessonMaterials: { materials: [] }, learningSetRef: null, archived: false, closure: null } };
    }
  }
  /** Mutates only course additions; retries never create or rename a native Session. */
  async update(ctx: MutationContext, patch: unknown): Promise<CourseView> {
    const parsed = CoursePatchSchema.parse(patch);
    return this.change(ctx, parsed, current => ({ ...current,
      ...(parsed.lessonMaterials === undefined ? {} : { lessonMaterials: parsed.lessonMaterials }),
      ...(parsed.learningSetRef === undefined ? {} : { learningSetRef: parsed.learningSetRef }),
      ...(parsed.archived === undefined ? {} : { archived: parsed.archived }),
    }));
  }
  /** Called by the confirmed close writer in P7; navigation never calls it. */
  async recordClosure(ctx: MutationContext, closure: CourseClosure): Promise<CourseView> {
    const parsed = CourseClosureSchema.parse(closure);
    return this.change(ctx, { closure: parsed }, current => {
      if (current.closure !== null) throw new RecordError('course_already_closed');
      return { ...current, closure: parsed };
    });
  }
  private async change(ctx: MutationContext, input: unknown, transform: (data: CourseMetadataData) => CourseMetadataData): Promise<CourseView> {
    const id = this.id(ctx);
    // Version zero denotes an absent optional teaching row. Its first atomic
    // create shares the same native id; a conflict cannot allocate another class.
    if (ctx.expectedVersion === 0) {
      const initial: CourseMetadataData = { sessionId: this.session(ctx), lessonMaterials: { materials: [] }, learningSetRef: null, archived: false, closure: null };
      try {
        const saved = await this.records.create(ctx, id, transform(initial));
        return { version: saved.version, data: saved.data };
      } catch (error) {
        if (error instanceof RecordError && error.code === 'record_exists') throw new RecordError('version_conflict');
        throw error;
      }
    }
    const saved = await this.records.update(ctx, 'course:' + id, input, current => {
      if (current.sessionId !== this.session(ctx)) throw new RecordError('course_binding_mismatch');
      return transform(current);
    });
    return { version: saved.version, data: saved.data };
  }
}
