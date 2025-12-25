using System.Text;
using System.Xml;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Infrastructure.Xml;

public sealed class ReportXmlBuilder : IXmlBuilder
{
    public Task<XmlBuildResult> BuildAsync(ReportMetadata metadata, IReadOnlyList<Section> sections, CancellationToken ct = default)
    {
        var settings = new XmlWriterSettings
        {
            Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            Indent = true,
            NewLineChars = "\n",
            ConformanceLevel = ConformanceLevel.Fragment,
            OmitXmlDeclaration = true
        };

        using var ms = new MemoryStream();
        using (var writer = XmlWriter.Create(ms, settings))
        {
            for (var sectionIndex = 0; sectionIndex < sections.Count; sectionIndex++)
            {
                var section = sections[sectionIndex];

                if (sectionIndex > 0)
                {
                    writer.WriteWhitespace("\n");
                }

                writer.WriteString(section.Title);
                writer.WriteWhitespace("\n");

                writer.WriteRaw("<br>");
                writer.WriteWhitespace("\n");

                writer.WriteStartElement("ul");
                foreach (var paragraph in section.Paragraphs)
                {
                    writer.WriteWhitespace("\n");
                    writer.WriteStartElement("li");
                    writer.WriteString(paragraph);
                    writer.WriteEndElement(); // li
                }
                writer.WriteWhitespace("\n");
                writer.WriteEndElement(); // ul
            }
        }

        var content = ms.ToArray();
        return Task.FromResult(new XmlBuildResult(content, "application/xml", "report.xml"));
    }
}
