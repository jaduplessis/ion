import {
  LambdaClient,
  InvokeCommand,
  InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import { Resource } from "../resource.js";

const lambda = new LambdaClient();

export interface PutEvent {
  /**
   * The vector to store in the database.
   * @example
   * ```js
   * {
   *   vector: [32.4, 6.55, 11.2, 10.3, 87.9],
   * }
   * ```
   */
  vector: number[];
  /**
   * Metadata for the event in JSON format.
   * This metadata will be used to filter when quering and removing vectors.
   * @example
   * ```js
   * {
   *   metadata: {
   *     type: "movie",
   *     id: "movie-123",
   *     name: "Spiderman",
   *   }
   * }
   * ```
   */
  metadata: Record<string, any>;
}

export interface QueryEvent {
  /**
   * The vector used to query the database.
   * @example
   * ```js
   * {
   *   vector: [32.4, 6.55, 11.2, 10.3, 87.9],
   * }
   * ```
   */
  vector: number[];
  /**
   * The metadata used to filter the vectors.
   * Only vectors that match the provided fields will be returned.
   * @example
   * ```js
   * {
   *   include: {
   *     type: "movie",
   *     release: "2001",
   *   }
   * }
   * ```
   * This will match the vector with metadata:
   * ```js
   *  {
   *    type: "movie",
   *    name: "Spiderman",
   *    release: "2001",
   *  }
   * ```
   *
   * But not the vector with metadata:
   * ```js
   *  {
   *    type: "book",
   *    name: "Spiderman",
   *    release: "2001",
   *  }
   * ```
   */
  include: Record<string, any>;
  /**
   * Exclude vectors with metadata that match the provided fields.
   * @example
   * ```js
   * {
   *   include: {
   *     type: "movie",
   *     release: "2001",
   *   },
   *   exclude: {
   *     name: "Spiderman",
   *   }
   * }
   * ```
   * This will match the vector with metadata:
   * ```js
   *  {
   *    type: "movie",
   *    name: "A Beautiful Mind",
   *    release: "2001",
   *  }
   * ```
   *
   * But not the vector with metadata:
   * ```js
   *  {
   *    type: "book",
   *    name: "Spiderman",
   *    release: "2001",
   *  }
   * ```
   */
  exclude?: Record<string, any>;
  /**
   * The threshold of similarity between the prompt and the queried vectors.
   * Only vectors with a similarity score higher than the threshold will be returned.
   * Expected value is between 0 and 1.
   * - 0 means the prompt and the queried vectors are completely different.
   * - 1 means the prompt and the queried vectors are identical.
   * @default `0`
   * @example
   * ```js
   * {
   *   threshold: 0.5,
   * }
   * ```
   */
  threshold?: number;
  /**
   * The number of results to return.
   * @default `10`
   * @example
   * ```js
   * {
   *   count: 10,
   * }
   * ```
   */
  count?: number;
}

export interface RemoveEvent {
  /**
   * The metadata used to filter the removal of vectors.
   * Only vectors with metadata that match the provided fields will be removed.
   * @example
   * To remove vectors for movie with id "movie-123":
   * ```js
   * {
   *   include: {
   *     id: "movie-123",
   *   }
   * }
   * ```
   * To remove vectors for all movies:
   * ```js
   *  {
   *   include: {
   *    type: "movie",
   *   }
   *  }
   * ```
   */
  include: Record<string, any>;
}

export interface QueryResponse {
  /**
   * Metadata for the event in JSON format that was provided when storing the vector.
   */
  metadata: Record<string, any>;
  /**
   * The similarity score between the prompt and the queried vector.
   */
  score: number;
}

export interface VectorClientResponse {
  put: (event: PutEvent) => Promise<void>;
  query: (event: QueryEvent) => Promise<QueryResponse>;
  remove: (event: RemoveEvent) => Promise<void>;
}

/**
 * Create a client to interact with the Vector database.
 * @example
 * ```js
 * import { VectorClient } from "sst";
 * const client = VectorClient("MyVectorDB");
 *
 * // Store a vector into the db
 * await client.put({
 *   vector: [32.4, 6.55, 11.2, 10.3, 87.9],
 *   metadata: { type: "movie", genre: "comedy" },
 * });
 *
 * // Query vectors similar to the provided vector
 * const result = await client.query({
 *   vector: [32.4, 6.55, 11.2, 10.3, 87.9],
 *   include: { type: "movie" },
 *   exclude: { genre: "thriller" },
 * });
 * ```
 */
export function VectorClient<
  T extends keyof {
    // @ts-expect-error
    [key in keyof Resource as "sst.aws.Vector" extends Resource[key]["type"]
      ? string extends key
        ? never
        : key
      : never]: Resource[key];
  },
>(name: T): VectorClientResponse {
  return {
    put: async (event: PutEvent) => {
      const ret = await lambda.send(
        new InvokeCommand({
          // @ts-expect-error
          FunctionName: Resource[name].putFunction,
          Payload: JSON.stringify(event),
        })
      );

      parsePayload(ret, "Failed to store into the vector db");
    },

    query: async (event: QueryEvent) => {
      const ret = await lambda.send(
        new InvokeCommand({
          // @ts-expect-error
          FunctionName: Resource[name].queryFunction,
          Payload: JSON.stringify(event),
        })
      );
      return parsePayload<QueryResponse>(ret, "Failed to query the vector db");
    },

    remove: async (event: RemoveEvent) => {
      const ret = await lambda.send(
        new InvokeCommand({
          // @ts-expect-error
          FunctionName: Resource[name].removeFunction,
          Payload: JSON.stringify(event),
        })
      );
      parsePayload(ret, "Failed to remove from the vector db");
    },
  };
}

function parsePayload<T>(output: InvokeCommandOutput, message: string): T {
  const payload = JSON.parse(Buffer.from(output.Payload!).toString());

  // Set cause to the payload so that it can be logged in CloudWatch
  if (output.FunctionError) {
    const e = new Error(message);
    e.cause = payload;
    throw e;
  }

  return payload;
}
