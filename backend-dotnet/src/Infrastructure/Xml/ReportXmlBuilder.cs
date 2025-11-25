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
            foreach (var section in sections)
            {
                writer.WriteStartElement("p");
                writer.WriteAttributeString("style", "text-align: justify;");
                writer.WriteString(section.Title);
                writer.WriteEndElement(); // p

                writer.WriteStartElement("ul");
                foreach (var paragraph in section.Paragraphs)
                {
                    writer.WriteStartElement("li");
                    writer.WriteStartElement("div");
                    writer.WriteAttributeString("style", "text-align: justify;");
                    writer.WriteString(paragraph);
                    writer.WriteEndElement(); // div
                    writer.WriteEndElement(); // li
                }
                writer.WriteEndElement(); // ul
            }
        }

        var content = ms.ToArray();
        return Task.FromResult(new XmlBuildResult(content, "application/xml", "report.xml"));
    }
}
