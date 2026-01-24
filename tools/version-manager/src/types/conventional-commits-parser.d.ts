declare module 'conventional-commits-parser' {
  export interface Note {
    title: string;
    text: string;
  }

  export interface Reference {
    action?: string;
    owner?: string;
    repository?: string;
    issue: string;
    raw: string;
    prefix: string;
  }

  export interface Commit {
    type: string | null;
    scope: string | null;
    subject: string | null;
    merge: string | null;
    header: string | null;
    body: string | null;
    footer: string | null;
    notes: Note[];
    references: Reference[];
    mentions: string[];
    revert: any;
  }

  export interface Options {
    headerPattern?: RegExp;
    headerCorrespondence?: string[];
    referenceActions?: string[];
    issuePrefixes?: string[];
    noteKeywords?: string[];
    fieldPattern?: RegExp;
    revertPattern?: RegExp;
    revertCorrespondence?: string[];
    warn?: boolean | Function;
    mergePattern?: RegExp;
    mergeCorrespondence?: string[];
  }

  function sync(commit: string, options?: Options): Commit;
  function parser(options?: Options): NodeJS.ReadWriteStream;

  export { sync, parser };
  export default { sync, parser };
}
