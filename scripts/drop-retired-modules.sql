-- 2026-10-21：确认版本、工单/售后、现场照片三块功能没有任何真实数据，按决定整体下线。
-- 迁移只追加、不改写历史：老库重放时会先由 create-work-orders.sql 等文件建表，再由本文件删除。
-- 保留在原文件里的建表语句用于解释当时的数据模型，不再代表现行结构。
drop table if exists work_order_photos;
drop table if exists work_order_work_lines;
drop table if exists work_order_items;
drop table if exists work_orders;
drop table if exists work_org_pricing;
drop table if exists work_pricing_catalog;
drop table if exists project_point_map_versions;
drop table if exists project_site_photos;
