export function validateProps(schema, props, componentName) {
  let result;
  try {
    result = schema.safeParse(props);
  } catch (error) {
    const message = `${componentName} schema parse failed: ${String(error?.message || error)}`;
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      throw new Error(message);
    }
    console.error(message);
    return props;
  }
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
