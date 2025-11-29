using System.Text;
using System.Xml;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Infrastructure.Xml;

public sealed class ReportXmlBuilder : IXmlBuilder
{
        public Task<XmlBuildResult> BuildAsync(ReportMetadata metadata, IReadOnlyList<Section> sections, CancellationToken ct = default)
        {
            var firstParagraph = true;
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
                var lastSectionIndex = sections.Count - 1;

                for (var sectionIndex = 0; sectionIndex < sections.Count; sectionIndex++)
                {
                    var section = sections[sectionIndex];
                    writer.WriteStartElement("p");
                    if (!firstParagraph)
                    {
                        writer.WriteAttributeString("style", "text-align: justify;");
                    }
                    writer.WriteString(section.Title);
                    writer.WriteEndElement(); // p
                    firstParagraph = false;

                    writer.WriteStartElement("ul");
                    for (var paragraphIndex = 0; paragraphIndex < section.Paragraphs.Count; paragraphIndex++)
                    {
                        var paragraph = section.Paragraphs[paragraphIndex];
                        var isLastParagraph = sectionIndex == lastSectionIndex &&
                                              paragraphIndex == section.Paragraphs.Count - 1;

                        writer.WriteStartElement("li");
                        if (isLastParagraph)
                        {
                            writer.WriteString(paragraph);
                        }
                        else
                        {
                            writer.WriteStartElement("div");
                            writer.WriteAttributeString("style", "text-align: justify;");
                            writer.WriteString(paragraph);
                            writer.WriteEndElement(); // div
                        }
                        writer.WriteEndElement(); // li
                    }
                    writer.WriteEndElement(); // ul
                }
            }

        var content = ms.ToArray();
        return Task.FromResult(new XmlBuildResult(content, "application/xml", "report.xml"));
    }
}
