type GraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function adminGraphql<T>(
  admin: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : {});
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  if (!json.data) {
    throw new Error("Shopify Admin API returned no data.");
  }

  return json.data;
}

export function userErrorMessage(
  errors: Array<{ field?: string[] | null; message: string }> | undefined,
): string | null {
  if (!errors?.length) return null;
  return errors
    .map((error) =>
      error.field?.length
        ? `${error.field.join(".")}: ${error.message}`
        : error.message,
    )
    .join("; ");
}
