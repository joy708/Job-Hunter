import { jsPDF } from 'jspdf';
import type { ResumeData } from '../types/workspace.ts';

function sanitizeSlug(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

export function exportResumeToPdf(
  resume: ResumeData,
  options?: { company?: string; jobTitle?: string }
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28
  const pageHeight = doc.internal.pageSize.getHeight(); // 841.89
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;
  let y = 38;

  const ensureSpace = (neededPt: number) => {
    if (y + neededPt > pageHeight - 30) {
      doc.addPage();
      y = 36;
    }
  };

  const drawSectionHeading = (title: string) => {
    ensureSpace(26);
    y += 6;
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(title, marginX, y);
    y += 4;
    doc.setDrawColor(71, 85, 105);
    doc.setLineWidth(0.6);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 12;
  };

  const drawWrappedText = (
    text: string,
    x: number,
    maxWidth: number,
    fontSize: number,
    lineHeight: number,
    style: 'normal' | 'bold' | 'italic' = 'normal'
  ) => {
    doc.setFont('times', style);
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight + 2);
      doc.text(line, x, y);
      y += lineHeight;
    }
  };

  // Header: Full Name
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text(resume.fullName, pageWidth / 2, y, { align: 'center' });
  y += 15;

  // Contact Line
  const contactParts = [
    resume.email,
    resume.phone,
    resume.linkedinLabel,
    resume.location,
  ].filter(Boolean);
  doc.setFont('times', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  doc.text(contactParts.join('   |   '), pageWidth / 2, y, { align: 'center' });
  y += 10;

  // Summary
  if (resume.summary.trim()) {
    drawSectionHeading('Summary');
    doc.setTextColor(15, 23, 42);
    drawWrappedText(resume.summary.trim(), marginX, contentWidth, 9.4, 12.2, 'normal');
  }

  // Experience
  if (resume.experience.length > 0) {
    drawSectionHeading('Experience');
    for (const exp of resume.experience) {
      ensureSpace(28);
      doc.setFont('times', 'bold');
      doc.setFontSize(9.8);
      doc.setTextColor(15, 23, 42);
      doc.text(exp.role, marginX, y);
      doc.setFont('times', 'normal');
      doc.text(exp.period, pageWidth - marginX, y, { align: 'right' });
      y += 11.5;

      doc.setFont('times', 'italic');
      doc.setFontSize(9.4);
      doc.setTextColor(51, 65, 85);
      doc.text(exp.company, marginX, y);
      y += 12.5;

      doc.setTextColor(15, 23, 42);
      for (const bullet of exp.bullets) {
        const cleanBullet = bullet.trim();
        if (!cleanBullet) continue;
        doc.setFont('times', 'normal');
        doc.setFontSize(9.2);
        const bulletIndent = marginX + 10;
        const lines = doc.splitTextToSize(cleanBullet, contentWidth - 12) as string[];
        ensureSpace(lines.length * 11.5 + 2);
        doc.text('•', marginX + 2, y);
        for (const line of lines) {
          doc.text(line, bulletIndent, y);
          y += 11.5;
        }
        y += 1.5;
      }
      y += 2;
    }
  }

  // Technical Skills
  if (resume.skills.length > 0) {
    drawSectionHeading('Technical Skills');
    doc.setTextColor(15, 23, 42);
    for (const group of resume.skills) {
      const label = `${group.category}: `;
      doc.setFont('times', 'bold');
      doc.setFontSize(9.3);
      const labelWidth = doc.getTextWidth(label);
      const fullLine = `${label}${group.items}`;
      doc.setFont('times', 'normal');
      const wrapped = doc.splitTextToSize(fullLine, contentWidth) as string[];
      ensureSpace(wrapped.length * 11.5 + 2);

      wrapped.forEach((line, idx) => {
        if (idx === 0 && line.startsWith(label)) {
          doc.setFont('times', 'bold');
          doc.text(label, marginX, y);
          doc.setFont('times', 'normal');
          doc.text(line.slice(label.length), marginX + labelWidth, y);
        } else {
          doc.setFont('times', 'normal');
          doc.text(line, marginX, y);
        }
        y += 11.5;
      });
      y += 1;
    }
  }

  // Education
  if (resume.education.length > 0) {
    drawSectionHeading('Education');
    for (const edu of resume.education) {
      ensureSpace(24);
      doc.setFont('times', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(edu.institution, marginX, y);
      doc.setFont('times', 'normal');
      doc.text(edu.period, pageWidth - marginX, y, { align: 'right' });
      y += 11.5;
      doc.setFont('times', 'normal');
      doc.setFontSize(9.2);
      doc.setTextColor(51, 65, 85);
      doc.text(edu.degree, marginX, y);
      y += 12.5;
    }
  }

  // Publications
  if (resume.publications.length > 0) {
    drawSectionHeading('Publications');
    for (const pub of resume.publications) {
      ensureSpace(22);
      doc.setFont('times', 'bold');
      doc.setFontSize(9.3);
      doc.setTextColor(15, 23, 42);
      drawWrappedText(pub.title, marginX, contentWidth, 9.3, 11.5, 'bold');
      doc.setFont('times', 'italic');
      doc.setFontSize(9.1);
      doc.setTextColor(51, 65, 85);
      doc.text(pub.venue, marginX, y);
      y += 11.5;
    }
  }

  // Achievements & Certifications
  if (resume.achievements.length > 0) {
    drawSectionHeading('Achievements & Certifications');
    doc.setTextColor(15, 23, 42);
    for (const ach of resume.achievements) {
      const cleanAch = ach.trim();
      if (!cleanAch) continue;
      doc.setFont('times', 'normal');
      doc.setFontSize(9.2);
      const lines = doc.splitTextToSize(cleanAch, contentWidth - 12) as string[];
      ensureSpace(lines.length * 11.5 + 2);
      doc.text('•', marginX + 2, y);
      for (const line of lines) {
        doc.text(line, marginX + 10, y);
        y += 11.5;
      }
      y += 1;
    }
  }

  const nameSlug = sanitizeSlug(resume.fullName) || 'Resume';
  const companyPart = options?.company ? `_${sanitizeSlug(options.company)}` : '';
  const rolePart = options?.jobTitle ? `_${sanitizeSlug(options.jobTitle)}` : '';
  const fileName = `${nameSlug}${companyPart}${rolePart}.pdf`;

  doc.save(fileName);
}
