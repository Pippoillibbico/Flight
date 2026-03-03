export function validateProps(schema, props, componentName) {
  const result = schema.safeParse(props);
  if (result.success) return result.data;

  const message = `${componentName} received invalid props: ${result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join(', ')}`;

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    throw new Error(message);
  }

  console.error(message);
  return props;
}

