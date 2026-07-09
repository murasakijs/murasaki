interface JsonLdProps {
  data: Record<string, unknown>;
}

/** Render trusted, server-generated structured data without allowing `</script>` injection. */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON comes only from trusted application data and `<` is escaped.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
